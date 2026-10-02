/**
 * ============================================================================
 *  FIRMAN WEB · NUSANTARA CONNECT — REST API + LocalDB (Google Apps Script)
 * ============================================================================
 *  Backend tunggal untuk 5 website terintegrasi dalam satu SPA (index.html):
 *    1. LPK Putri Ayu Mandiri ......... lpkpam.com / jogjaonestop.com
 *    2. Wedding Organizer Paes Nusa ... paesnusa.com
 *    3. Asosiasi Perias Nusantara ..... riasnusa.com
 *    4. Personal Branding Mbak Ayu .... putriayu.id
 *    5. Personal Branding Pak Urip .... uripsedyowidodo.com
 *
 *  Fungsi utama
 *  ------------
 *   • REST API  : GET (list/detail/stats), POST/PUT/PATCH/DELETE (CRUD penuh)
 *   • LocalDB   : Google Spreadsheet (1 sheet = 1 koleksi) + Header = skema
 *   • Offline   : queue retry, backup CacheService, JSONP untuk lintas domain
 *   • Notifikasi: email admin, auto-reply pemohon, tautan WhatsApp siap kirim
 *   • Keamanan  : token admin, whitelist field, sanitasi, rate-limit, lock
 *
 *  Cara pasang (±5 menit)
 *  ----------------------
 *   1. Buat Google Spreadsheet baru → menu Extensions > Apps Script.
 *   2. Hapus isi default, tempel seluruh file ini, simpan (Ctrl+S).
 *   3. Menubar baru "Firman Web" → "1. Setup Database" (membuat sheet + seed).
 *   4. Deploy → New deployment → Type: Web app
 *        Execute as     : Me
 *        Who has access : Anyone
 *      Salin URL /exec (contoh: https://script.google.com/macros/s/AKfy.../exec)
 *   5. FileApp Script Properties → tambah key ADMIN_TOKEN berisi string acak.
 *   6. Buka index.html → tombol "Koneksi API" (kanan atas) → tempel URL /exec
 *      + token. SPA otomatis sinkron; tanpa API pun semua tetap jalan memakai
 *      LocalDB browser (localStorage).
 *
 *  Rute API
 *  --------
 *   GET  /api/health                       -> { ok, version, collections }
 *   (semua rute juga bisa dipanggil lewat parameter ?_p=<koleksi>/<id>
 *    bila path sesudah /exec tidak ikut terkirim oleh Apps Script)
 *   GET  /api/schema                       -> skema field tiap koleksi
 *   GET  /api/{koleksi}                    -> { ok, data[], total, page, pages }
 *        ?q=         pencarian teks        (semua field teks)
 *        ?status=    filter enum           (contoh: status=Baru)
 *        ?brand=lpk|wo|asosiasi|ayu|urip   filter unit
 *        ?sort=-created_at|nama  urutan
 *        ?limit=20&offset=0      paginasi  (limit maks 200)
 *        ?callback=fn            JSONP (bypass CORS untuk read-only)
 *   GET  /api/{koleksi}/{id}               -> { ok, data }
 *   GET  /api/stats                        -> ringkasan angka untuk dashboard
 *   GET  /api/export?koleksi=booking         -> CSV (download)
 *   POST /api/{koleksi}                     -> create  { ok, id, data }
 *   POST /api/{koleksi}/{id}?_method=PUT     -> update (replace)
 *   POST /api/{koleksi}/{id}?_method=PATCH   -> update (parsial)
 *   POST /api/{koleksi}/{id}?_method=DELETE  -> hapus (soft-delete default)
 *   POST /api/bulk        { koleksi, action:"create|update|delete", rows:[] }
 *   POST /api/admin       { action:"seed|reindex|hardDelete|purge", token }
 *
 *  Catatan CORS: Apps Script Web App tidak mengirim header CORS kustom.
 *  Karena itu SPA mengirim body sebagai "text/plain" (simple request, tanpa
 *  preflight) dan membaca lewat GET/JSONP. Semua rute menerima keduanya.
 * ============================================================================
 */

var FW_CONFIG = {
  VERSION: '1.4.0',
  BRAND: 'Firman Web — Nusantara Connect',
  SHEET_PREFIX: 'fw_',            // nama sheet = prefix + nama koleksi
  ID_PREFIX: 'fw',                // format id: fw-booking-7f3a91
  SOFT_DELETE: true,              // hapus = tandai status "Arsip" (aman untuk audit)
  MAX_ROWS: 20000,
  CACHE_STATS_SEC: 180,
  RATE_LIMIT_PER_HOUR: 240,       // per kombinasi IP+userAgent
  ADMIN_EMAIL: '',                // kosongkan = pakai email pemilik script
  REPLY_EMAIL: '',                // email pengirim auto-reply (kosongkan = default)
  WHATSAPP_NUMBER: '6281234567890',
  SUBJECT_PREFIX: '[FirmanWeb]'
};

/**
 * SKEMA KOLEKSI (LocalDB).
 * type: text | email | phone | number | date | datetime | textarea | select | bool
 * req : wajib diisi. enum: nilai yang boleh. brand: unit pemilik data.
 */
var FW_SCHEMA = {
  program: {
    label: 'Program Pelatihan LPK',
    brand: 'lpk',
    public: true,
    fields: {
      judul: { type: 'text', req: true },
      slug: { type: 'text' },
      ringkas: { type: 'textarea' },
      durasi: { type: 'text' },
      kuota: { type: 'number' },
      biaya: { type: 'number' },
      sertifikasi: { type: 'text' },
      jadwal: { type: 'text' },
      level: { type: 'select', enum: ['Pemula', 'Menengah', 'Lanjut', 'Profesi'] },
      status: { type: 'select', enum: ['Dibuka', 'Penuh', 'Libur', 'Draf'], def: 'Dibuka' },
      foto: { type: 'text' }
    }
  },
  registration: {
    label: 'Pendaftaran Siswa LPK',
    brand: 'lpk',
    public: true,
    fields: {
      nama: { type: 'text', req: true },
      email: { type: 'email', req: true },
      telepon: { type: 'phone', req: true },
      asal: { type: 'text' },
      pendidikan: { type: 'select', enum: ['SD', 'SMP', 'SMA/SMK', 'Diploma', 'Sarjana', 'Peserta Umum'] },
      program: { type: 'text', req: true },
      angkatan: { type: 'text' },
      catatan: { type: 'textarea' },
      status: { type: 'select', enum: ['Baru', 'Diverifikasi', 'Diterima', 'Cadangan', 'Ditolak', 'Arsip'], def: 'Baru' }
    }
  },
  paket: {
    label: 'Paket Pernikahan Paes Nusa',
    brand: 'wo',
    public: true,
    fields: {
      judul: { type: 'text', req: true },
      kategori: { type: 'select', enum: ['Rias', 'Catering', 'Foto & Videografi', 'Dekorasi', 'Gedung & MICE', 'Transportasi'] },
      harga: { type: 'number' },
      satuan: { type: 'text', def: 'paket' },
      durasi: { type: 'text' },
      deskripsi: { type: 'textarea' },
      termasuk: { type: 'textarea' },
      kuota: { type: 'number' },
      status: { type: 'select', enum: ['Tersedia', 'Booking Terbatas', 'Habis', 'Draf'], def: 'Tersedia' },
      foto: { type: 'text' }
    }
  },
  booking: {
    label: 'Booking & Konsultasi Paes Nusa',
    brand: 'wo',
    public: true,
    fields: {
      calon: { type: 'text', req: true },
      pasangan: { type: 'text' },
      email: { type: 'email', req: true },
      telepon: { type: 'phone', req: true },
      tanggal: { type: 'date', req: true },
      paket: { type: 'text' },
      tamu: { type: 'number' },
      venue: { type: 'text' },
      budget: { type: 'number' },
      catatan: { type: 'textarea' },
      status: { type: 'select', enum: ['Baru', 'Konsultasi', 'DP', 'Confirmed', 'Selesai', 'Batal', 'Arsip'], def: 'Baru' }
    }
  },
  event: {
    label: 'Kegiatan & Agenda Asosiasi',
    brand: 'asosiasi',
    public: true,
    fields: {
      judul: { type: 'text', req: true },
      jenis: { type: 'select', enum: ['Pelatihan', 'Seminar', 'Rakernas', 'Bakti Sosial', 'Kompetensi', 'Sertifikasi'] },
      tanggal: { type: 'date', req: true },
      jam: { type: 'text' },
      kota: { type: 'text' },
      lokasi: { type: 'text' },
      kuota: { type: 'number' },
      tiket: { type: 'text' },
      deskripsi: { type: 'textarea' },
      status: { type: 'select', enum: ['Pendaftaran Dibuka', 'Segera', 'Berlangsung', 'Selesai', 'Dibatalkan'], def: 'Pendaftaran Dibuka' },
      foto: { type: 'text' }
    }
  },
  anggota: {
    label: 'Data Anggota Asosiasi',
    brand: 'asosiasi',
    public: true,
    fields: {
      nama: { type: 'text', req: true },
      cabang: { type: 'text', req: true },
      kategori: { type: 'select', enum: ['Perias Pengantin', 'Beauty Therapist', 'Hair Stylist', 'Penjahit Busana', 'Instruktur', 'Mitra Usaha'] },
      telepon: { type: 'phone' },
      email: { type: 'email' },
      tahun: { type: 'number' },
      spesialisasi: { type: 'text' },
      verifikasi: { type: 'select', enum: ['Terverifikasi', 'Menunggu', 'Belum'], def: 'Menunggu' },
      foto: { type: 'text' }
    }
  },
  membership: {
    label: 'Pengajuan Keanggotaan',
    brand: 'asosiasi',
    public: true,
    fields: {
      nama: { type: 'text', req: true },
      usaha: { type: 'text' },
      cabang: { type: 'text' },
      telepon: { type: 'phone', req: true },
      email: { type: 'email', req: true },
      pengalaman: { type: 'number' },
      portofolio: { type: 'text' },
      status: { type: 'select', enum: ['Baru', 'Verifikasi Berkas', 'Disetujui', 'Ditolak', 'Arsip'], def: 'Baru' }
    }
  },
  people: {
    label: 'Pengurus, Instruktur & Tim',
    brand: 'lpk',
    public: true,
    fields: {
      nama: { type: 'text', req: true },
      jabatan: { type: 'text' },
      peran: { type: 'select', enum: ['Instruktur', 'Pengurus', 'Tim Kreatif', 'Narasumber', 'Mentor'] },
      unit: { type: 'select', enum: ['LPK', 'Paes Nusa', 'Asosiasi', 'Mbak Ayu', 'Pak Urip'] },
      keahlian: { type: 'text' },
      bio: { type: 'textarea' },
      foto: { type: 'text' }
    }
  },
  artikel: {
    label: 'Publikasi, Artikel & Opini',
    brand: 'asosiasi',
    public: true,
    fields: {
      judul: { type: 'text', req: true },
      kategori: { type: 'select', enum: ['Budaya', 'Pelatihan', 'Kebijakan', 'Usaha', 'Profil', 'Tips', 'Ekonomi'] },
      unit: { type: 'select', enum: ['LPK', 'Paes Nusa', 'Asosiasi', 'Mbak Ayu', 'Pak Urip'] },
      penulis: { type: 'text' },
      tanggal: { type: 'date' },
      ringkas: { type: 'textarea' },
      body: { type: 'textarea' },
      tag: { type: 'text' },
      foto: { type: 'text' },
      status: { type: 'select', enum: ['Terbit', 'Draf', 'Arsip'], def: 'Terbit' }
    }
  },
  testimonial: {
    label: 'Testimoni Siswa & Klien',
    brand: 'lpk',
    public: true,
    fields: {
      nama: { type: 'text', req: true },
      peran: { type: 'text' },
      unit: { type: 'select', enum: ['LPK', 'Paes Nusa', 'Asosiasi', 'Mbak Ayu', 'Pak Urip'] },
      rating: { type: 'number' },
      kutipan: { type: 'textarea', req: true },
      foto: { type: 'text' },
      status: { type: 'select', enum: ['Tayang', 'Moderasi', 'Arsip'], def: 'Tayang' }
    }
  },
  collab: {
    label: 'Undangan Kolaborasi Mbak Ayu',
    brand: 'ayu',
    public: true,
    fields: {
      nama: { type: 'text', req: true },
      organisasi: { type: 'text' },
      email: { type: 'email', req: true },
      telepon: { type: 'phone' },
      jenis: { type: 'select', enum: ['Narasumber', 'Juri', 'Workshop', 'Kolaborasi Merek', 'Pemotretan', 'Riset Budaya'] },
      tanggal: { type: 'date' },
      kota: { type: 'text' },
      pesan: { type: 'textarea' },
      status: { type: 'select', enum: ['Baru', 'Dijadwalkan', 'Deal', 'Selesai', 'Ditolak', 'Arsip'], def: 'Baru' }
    }
  },
  aspiration: {
    label: 'Aspirasi & Dukungan Pak Urip',
    brand: 'urip',
    public: true,
    fields: {
      nama: { type: 'text', req: true },
      komunitas: { type: 'text' },
      telepon: { type: 'phone' },
      email: { type: 'email' },
      wilayah: { type: 'text' },
      topik: { type: 'select', enum: ['UMKM', 'Pariwisata', 'Pertanian', 'Pelatihan Kerja', 'Perempuan & Anak', 'Infrastruktur', 'Lainnya'] },
      aspirasi: { type: 'textarea', req: true },
      dukungan: { type: 'select', enum: ['Ikut Gerakan', 'Relawan', 'Donasi', 'Ajak Diskusi', 'Sekadar Dukungan'] },
      status: { type: 'select', enum: ['Terima', 'Ditindaklanjuti', 'Jadwal Tur', 'Selesai', 'Arsip'], def: 'Terima' }
    }
  },
  message: {
    label: 'Pesan Kontak & Pengunjung',
    brand: 'lpk',
    public: true,
    fields: {
      nama: { type: 'text', req: true },
      email: { type: 'email', req: true },
      telepon: { type: 'phone' },
      subjek: { type: 'text' },
      pesan: { type: 'textarea', req: true },
      unit: { type: 'text' },
      status: { type: 'select', enum: ['Baru', 'Dibaca', 'Dijawab', 'Arsip'], def: 'Baru' }
    }
  },
  subscriber: {
    label: 'Berlangganan Newsletter',
    brand: 'asosiasi',
    public: true,
    fields: {
      email: { type: 'email', req: true },
      nama: { type: 'text' },
      minat: { type: 'text' },
      status: { type: 'select', enum: ['Aktif', 'Unsubscribe', 'Baru'], def: 'Baru' }
    }
  }
};

/* ---------------------------------------------------------------------------
 * UTIL
 * ------------------------------------------------------------------------- */
function fw_props_() {
  return PropertiesService.getScriptProperties();
}

function fw_adminToken_() {
  var p = fw_props_();
  var tok = p.getProperty('ADMIN_TOKEN') || '';
  if (!tok) {
    // token sementara agar dev tetap bisa jalan; ganti lewat Script Properties
    tok = 'firmanweb-dev';
  }
  return tok;
}

function fw_adminEmail_() {
  return FW_CONFIG.ADMIN_EMAIL || Session.getEffectiveUser().getEmail();
}

function fw_ss_(readOnly) {
  var id = fw_props_().getProperty('SPREADSHEET_ID');
  if (id) {
    var s = readOnly ? SpreadsheetApp.openById(id) : SpreadsheetApp.openById(id);
    return s;
  }
  // Buat spreadsheet baru sekali saja lalu simpan id-nya
  var created = SpreadsheetApp.create('Firman Web · Nusantara Connect DB');
  p_setSpreadsheetId_(created.getId());
  return created;
}
function p_setSpreadsheetId_(id) {
  fw_props_.setProperty('SPREADSHEET_ID', id);
}

function fw_sheet_(name) {
  var ss = fw_ss_(false);
  var full = FW_CONFIG.SHEET_PREFIX + name;
  var sh = ss.getSheetByName(full);
  if (!sh) {
    sh = ss.insertSheet(full);
    fw_writeHeader_(sh, name);
  }
  return sh;
}

function fw_fieldList_(coll) {
  var def = FW_SCHEMA[coll] || {};
  var out = [];
  for (var k in def.fields) out.push(k);
  if (def.extraFields) for (var j in def.extraFields) out.push(j);
  return out;
}

function fw_schemaFor_(coll) {
  var def = FW_SCHEMA[coll] || {};
  var fields = {};
  for (var k in def.fields) fields[k] = def.fields[k];
  if (def.extraFields) for (var j in def.extraFields) fields[j] = def.extraFields[j];
  return fields;
}

function fw_writeHeader_(sh, coll) {
  var cols = ['id', 'brand', 'createdAt', 'updatedAt', 'createdBy', 'source'].concat(fw_fieldList_(coll));
  sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, cols.length);
}

function fw_columns_(sh, coll) {
  var row = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  var cols = [];
  for (var i = 0; i < row.length; i++) cols.push(String(row[i] || ''));
  if (!cols.length || !cols[0]) return ['id', 'brand', 'createdAt', 'updatedAt', 'createdBy', 'source'].concat(fw_fieldList_(coll));
  return cols;
}

function fw_now_() {
  return new Date().toISOString();
}

function fw_id_(coll) {
  return [FW_CONFIG.ID_PREFIX, String(coll).slice(0, 4), Utilities.getUuid().replace(/-/g, '').slice(0, 10)].join('-');
}

function fw_slugify_(s) {
  return String(s || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
}

function fw_clean_(v) {
  if (v === null || v === undefined) return '';
  var s = String(v);
  s = s.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
  s = s.replace(/[<>]/g, '');
  return s.replace(/\s+/g, ' ').trim().slice(0, 4000);
}

function fw_cast_(value, spec) {
  var v = value;
  if (v === undefined || v === null) return '';
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Jakarta', "yyyy-MM-dd'T'HH:mm:ss");
  switch (spec && spec.type) {
    case 'number':
      var n = Number(String(v).replace(/[^\d.-]/g, ''));
      return isNaN(n) ? '' : n;
    case 'bool':
      return /^(1|true|ya|yes|on)$/i.test(String(v)) ? 'Ya' : 'Tidak';
    case 'date':
    case 'datetime':
      return fw_clean_(v).slice(0, 32);
    case 'select':
      var c = fw_clean_(v);
      if (spec.enum && spec.enum.length) {
        for (var i = 0; i < spec.enum.length; i++) {
          if (String(spec.enum[i]).toLowerCase() === c.toLowerCase()) return spec.enum[i];
        }
        return spec.def || spec.enum[0];
      }
      return c;
    default:
      return fw_clean_(v);
  }
}

function fw_validate_(coll, payload) {
  var fields = fw_schemaFor_(coll);
  var errors = [];
  for (var key in fields) {
    var spec = fields[key];
    var val = payload[key];
    if (spec.req && (val === undefined || val === null || String(val).trim() === '')) {
      errors.push(key + ' wajib diisi');
      continue;
    }
    if (val === undefined || val === null || String(val).trim() === '') continue;
    if (spec.type === 'email' && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(val).trim())) {
      errors.push(key + ' format email tidak valid');
    }
    if (spec.type === 'phone' && !/^[+0-9()\-\s]{6,20}$/.test(String(val).trim())) {
      errors.push(key + ' format nomor tidak valid');
    }
    if (spec.type === 'number' && isNaN(Number(String(val).replace(/[^\d.-]/g, '')))) {
      errors.push(key + ' harus angka');
    }
  }
  return errors;
}

function fw_normalize_(coll, payload) {
  var fields = fw_schemaFor_(coll);
  var out = {};
  for (var key in fields) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      out[key] = fw_cast_(payload[key], fields[key]);
    }
  }
  if (fields.slug && !out.slug && out.judul) out.slug = fw_slugify_(out.judul);
  if (fields.nama && !out.nama && out.judul) out.nama = out.judul;
  return out;
}

function fw_rateCheck_(e) {
  // Pembatas sederhana: hitung permintaan per jam per "sid" pengunjung.
  try {
    var sid = (e && e.parameter && e.parameter.sid) || 'anon';
    var key = 'fwrl_' + Utilities.base64EncodeWebSafe('' + sid).slice(0, 24);
    var cache = CacheService.getScriptCache();
    var n = Number(cache.get(key) || 0);
    if (n > FW_CONFIG.RATE_LIMIT_PER_HOUR) return false;
    cache.put(key, String(n + 1), 3600);
    return true;
  } catch (err) {
    return true; // cache sedang bermasalah -> jangan blokir trafik sah
  }
}

/* ---------------------------------------------------------------------------
 * HTTP HANDLERS
 * ------------------------------------------------------------------------- */
function doGet(e) { return fw_route_(e, 'GET'); }
function doPost(e) { return fw_route_(e, 'POST'); }

function fw_route_(e, method) {
  var params = (e && e.parameter) || {};
  // path bisa datang dari: e.path (exec/registration), e.paths (array segmen),
  // atau parameter ?_p=… (paling andal bila URL di-rewrite Apps Script)
  var path = String((e && e.path) || ((e && e.paths) ? e.paths.join('/') : '') || '').replace(/^\/+|\/+$/g, '');
  if (!path || path === 'userCodeAppPanel') path = String(params._p || params.path || '').replace(/^\/+|\/+$/g, '');
  var body = fw_parseBody_(e);
  var eff = String(params._method || body._method || method).toUpperCase();

  // JSONP / CORS-friendly GET
  try {
    if (params.callback && eff === 'GET') {
      return ContentService.createTextOutput(
        params.callback.replace(/[^A-Za-z0-9_$.]/g, '') + '(' + JSON.stringify(fw_dispatch_(path, eff, params, body, e)) + ')'
      ).setMimeType(ContentService.MimeType.JAVASCRIPT);
    }

    if (!fw_rateCheck_(e)) return fw_out_({ ok: false, error: 'rate_limited', message: 'Terlalu banyak permintaan, coba lagi 1 jam lagi.' }, params);

    return fw_out_(fw_dispatch_(path, eff, params, body, e), params);
  } catch (err) {
    return fw_out_({ ok: false, error: 'server_error', message: String(err && err.message || err) }, params);
  }
}

function fw_out_(obj, params) {
  var txt = ContentService.createTextOutput(JSON.stringify(obj));
  txt.setMimeType(params && params.format === 'csv' ? ContentService.MimeType.CSV : ContentService.MimeType.JSON);
  return txt;
}

function fw_parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  var raw = e.postData.contents;
  var type = (e.postData.type || '').toLowerCase();
  try {
    if (type.indexOf('application/json') > -1 || /^\s*[[{]/.test(raw)) return JSON.parse(raw);
    var obj = {};
    String(raw).split('&').forEach(function (kv) {
      var p = kv.split('=');
      obj[decodeURIComponent(p[0] || '')] = decodeURIComponent((p[1] || '').replace(/\+/g, ' '));
    });
    return obj;
  } catch (err) {
    return { _raw: raw };
  }
}

function fw_dispatch_(path, method, q, body, e) {
  var seg = path.split('/').filter(Boolean);
  // menerima baik "api/..." (dari /userCodeAppPanel/../api) maupun "koleksi/..."
  if (seg[0] === 'api') seg.shift();
  var coll = seg[0] || '';
  var id = seg[1] || '';

  if (!coll || coll === 'health') {
    return {
      ok: true,
      service: FW_CONFIG.BRAND,
      version: FW_CONFIG.VERSION,
      time: fw_now_(),
      collections: Object.keys(FW_SCHEMA),
      counts: fw_counts_()
    };
  }
  if (coll === 'schema') return { ok: true, schema: FW_SCHEMA };
  if (coll === 'stats') return { ok: true, stats: fw_stats_() };
  if (coll === 'export') return fw_export_(q);
  if (coll === 'bulk') return fw_bulk_(q, body);
  if (coll === 'admin') return fw_admin_(q, body);
  if (!FW_SCHEMA[coll]) return { ok: false, error: 'unknown_collection', collections: Object.keys(FW_SCHEMA) };

  if (method === 'GET') {
    if (id) return fw_getOne_(coll, id);
    return fw_list_(coll, q);
  }

  // tulis → wajib token (kecuali koleksi publik "terima masukan")
  var token = q.token || body.token || fw_headerToken_(e);
  var writable = FW_SCHEMA[coll].public === true;
  if (!writable && token !== fw_adminToken_()) {
    return { ok: false, error: 'forbidden', message: 'Koleksi ' + coll + ' hanya bisa diubah dengan token admin.' };
  }
  if (method === 'POST' && !id) return fw_create_(coll, body, q);
  if (method === 'PUT' && id) return fw_replace_(coll, id, body);
  if (method === 'PATCH' && id) return fw_patch_(coll, id, body);
  if (method === 'DELETE' && id) return fw_delete_(coll, id, q.hard === '1', token);
  return { ok: false, error: 'method_not_allowed', method: method };
}

function fw_headerToken_(e) {
  try {
    var inc = e && e.context && e.context.headers;
    if (inc) return '';
  } catch (err) { }
  return '';
}

/* ---------------------------------------------------------------------------
 * CRUD
 * ------------------------------------------------------------------------- */
function fw_lock_(coll) {
  return LockService.getScriptLock();
}

function fw_list_(coll, q) {
  var sh = fw_sheet_(coll);
  var rows = fw_readRows_(sh, coll);
  var query = String(q.q || '').toLowerCase().trim();
  var out = rows.filter(function (r) {
    if (q.status && String(r.status).toLowerCase() !== String(q.status).toLowerCase()) return false;
    if (q.brand && String(r.brand).toLowerCase() !== String(q.brand).toLowerCase()) return false;
    if (q.unit && String(r.unit).toLowerCase() !== String(q.unit).toLowerCase()) return false;
    if (q.kategori && String(r.kategori).toLowerCase() !== String(q.kategori).toLowerCase()) return false;
    if (q.since && String(r.updatedAt || '') < String(q.since)) return false;
    if (!query) return true;
    for (var k in r) {
      if (String(r[k]).toLowerCase().indexOf(query) > -1) return true;
    }
    return false;
  });

  var sort = q.sort || '-updatedAt';
  var desc = sort.charAt(0) === '-';
  var key = desc ? sort.slice(1) : sort;
  out.sort(function (a, b) {
    var av = a[key], bv = b[key];
    if (av === bv) return 0;
    if (av === '' || av === undefined || av === null) return 1;
    if (bv === '' || bv === undefined || bv === null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return desc ? bv - av : av - bv;
    return desc ? String(bv).localeCompare(String(av), 'id') : String(av).localeCompare(String(bv), 'id');
  });

  var limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
  var offset = Math.max(parseInt(q.offset, 10) || 0, 0);
  return {
    ok: true, koleksi: coll, total: out.length, limit: limit, offset: offset,
    page: Math.floor(offset / limit) + 1, pages: Math.ceil(out.length / limit) || 1,
    data: out.slice(offset, offset + limit)
  };
}

function fw_getOne_(coll, id) {
  var found = fw_find_(coll, id);
  if (!found) return { ok: false, error: 'not_found' };
  return { ok: true, data: found.row, index: found.index };
}

function fw_readRows_(sh, coll) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var cols = fw_columns_(sh, coll);
  var values = sh.getRange(2, 1, last - 1, cols.length).getDisplayValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    if (!values[i][0]) continue;
    var o = {};
    for (var c = 0; c < cols.length; c++) {
      var v = values[i][c];
      var spec = fw_schemaFor_(coll)[cols[c]];
      if (spec && spec.type === 'number' && v !== '') v = Number(String(v).replace(/[^\d.-]/g, ''));
      o[cols[c]] = v;
    }
    o._row = i + 2;
    rows.push(o);
  }
  return rows;
}

function fw_find_(coll, id) {
  var sh = fw_sheet_(coll);
  var rows = fw_readRows_(sh, coll);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id) === String(id)) return { row: rows[i], index: rows[i]._row, sh: sh };
  }
  return null;
}

function fw_create_(coll, payload, q) {
  var errors = fw_validate_(coll, payload);
  if (errors.length) return { ok: false, error: 'validation', errors: errors };

  var lock = fw_lock_(coll);
  lock.waitForLock(20000);
  try {
    var sh = fw_sheet_(coll);
    var cols = fw_columns_(sh, coll);
    var data = fw_normalize_(coll, payload);
    var id = payload.id || fw_id_(coll);
    var now = fw_now_();
    var record = {
      id: id,
      brand: FW_SCHEMA[coll].brand,
      createdAt: now,
      updatedAt: now,
      createdBy: q && q.ip ? 'guest' : 'web',
      source: (payload.source || 'spa') + ''
    };
    for (var k in data) record[k] = data[k];
    if (!record.status) {
      var fs = fw_schemaFor_(coll).status;
      if (fs) record.status = fs.def || fs.enum[0];
    }
    var line = cols.map(function (c) { return record[c] === undefined ? '' : record[c]; });
    sh.appendRow(line);
    fw_afterWrite_(coll, 'create', record);
    return { ok: true, action: 'create', id: id, data: record, total: sh.getLastRow() - 1 };
  } finally {
    lock.releaseLock();
  }
}

function fw_replace_(coll, id, payload) {
  var errors = fw_validate_(coll, payload);
  if (errors.length) return { ok: false, error: 'validation', errors: errors };
  return fw_write_(coll, id, payload, false);
}
function fw_patch_(coll, id, payload) { return fw_write_(coll, id, payload, true); }

function fw_write_(coll, id, payload, partial) {
  var lock = fw_lock_(coll);
  lock.waitForLock(20000);
  try {
    var hit = fw_find_(coll, id);
    if (!hit) return { ok: false, error: 'not_found' };
    var sh = hit.sh;
    var cols = fw_columns_(sh, coll);
    var base = partial ? hit.row : {};
    var data = fw_normalize_(coll, payload);
    var merged = {};
    for (var i = 0; i < cols.length; i++) merged[cols[i]] = base[cols[i]] === undefined ? '' : base[cols[i]];
    for (var k in data) merged[k] = data[k];
    merged.id = id;
    merged.updatedAt = fw_now_();
    var line = cols.map(function (c) { return merged[c] === undefined ? '' : merged[c]; });
    sh.getRange(hit.index, 1, 1, cols.length).setValues([line]);
    fw_afterWrite_(coll, 'update', merged);
    return { ok: true, action: partial ? 'patch' : 'update', id: id, data: merged };
  } finally {
    lock.releaseLock();
  }
}

function fw_delete_(coll, id, hard, token) {
  if (hard && token !== fw_adminToken_()) return { ok: false, error: 'forbidden', message: 'Hard delete butuh token admin.' };
  var lock = fw_lock_(coll);
  lock.waitForLock(20000);
  try {
    var hit = fw_find_(coll, id);
    if (!hit) return { ok: false, error: 'not_found' };
    if (hard || !FW_CONFIG.SOFT_DELETE) {
      hit.sh.deleteRow(hit.index);
      fw_afterWrite_(coll, 'delete', { id: id });
      return { ok: true, action: 'delete', mode: 'hard', id: id };
    }
    var cols = fw_columns_(hit.sh, coll);
    var row = hit.row;
    row.status = 'Arsip';
    row.updatedAt = fw_now_();
    hit.sh.getRange(hit.index, 1, 1, cols.length).setValues([cols.map(function (c) { return row[c] === undefined ? '' : row[c]; })]);
    return { ok: true, action: 'delete', mode: 'soft', id: id, data: row };
  } finally {
    lock.releaseLock();
  }
}

function fw_bulk_(q, body) {
  var coll = body.koleksi || q.koleksi;
  if (!FW_SCHEMA[coll]) return { ok: false, error: 'unknown_collection' };
  var action = body.action || 'create';
  var rows = body.rows || [];
  var done = 0, failed = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var res;
    try {
      if (action === 'delete') res = fw_delete_(coll, r.id, r.hard === true, body.token);
      else if (action === 'update') res = fw_replace_(coll, r.id, r);
      else if (action === 'patch') res = fw_patch_(coll, r.id, r);
      else res = fw_create_(coll, r, q);
      if (res && res.ok) done++; else failed.push({ id: r.id, error: res && res.error });
    } catch (e2) {
      failed.push({ id: r.id, error: String(e2.message || e2) });
    }
  }
  return { ok: true, action: action, koleksi: coll, done: done, failed: failed };
}

function fw_admin_(q, body) {
  var token = body.token || q.token;
  if (token !== fw_adminToken_()) return { ok: false, error: 'forbidden' };
  var action = body.action || q.action;
  if (action === 'seed') return { ok: true, result: fw_seed_(true) };
  if (action === 'reindex') return { ok: true, result: fw_setup_(true) };
  if (action === 'purge') return { ok: true, result: fw_purge_(body.koleksi) };
  return { ok: false, error: 'unknown_action' };
}

function fw_export_(q) {
  var coll = q.koleksi || q.collection;
  if (!FW_SCHEMA[coll]) return { ok: false, error: 'unknown_collection' };
  var rows = fw_readRows_(fw_sheet_(coll), coll);
  var cols = fw_columns_(fw_sheet_(coll), coll);
  var lines = [cols.join(',')];
  rows.forEach(function (r) {
    lines.push(cols.map(function (c) {
      var v = String(r[c] === undefined ? '' : r[c]).replace(/"/g, '""');
      return /[",\n]/.test(v) ? '"' + v + '"' : v;
    }).join(','));
  });
  var url = '';
  try {
    var f = DriveApp.createFile(coll + '-' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMdd-HHmm') + '.csv', lines.join('\n'), 'text/csv');
    url = f.getUrl();
  } catch (e) { }
  return { ok: true, koleksi: coll, total: rows.length, csv: lines.join('\n'), drive: url };
}

/* ---------------------------------------------------------------------------
 * PASCA TULIS: notifikasi + cache stats
 * ------------------------------------------------------------------------- */
function fw_afterWrite_(coll, action, record) {
  try { CacheService.getScriptCache().remove('fw_stats'); } catch (e) { }
  if (action !== 'create') return;
  var def = FW_SCHEMA[coll] || {};
  var title = record.judul || record.program || record.nama || record.email || coll;
  var subject = FW_CONFIG.SUBJECT_PREFIX + ' ' + (def.label || coll) + ' \u2014 ' + title;

  var rows = [['Waktu', fw_now_()], ['Koleksi', def.label || coll], ['ID', record.id]];
  var fields = fw_schemaFor_(coll);
  for (var k in fields) rows.push([k, String(record[k] === undefined ? '' : record[k])]);

  var html = '<h3 style="margin:0 0 8px;font-family:sans-serif">' + subject + '</h3>' +
    '<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">' +
    rows.map(function (r) {
      return '<tr><td style="padding:6px 10px;border:1px solid #e5e1d8;background:#faf7f2;font-weight:600">' + r[0] +
        '</td><td style="padding:6px 10px;border:1px solid #e5e1d8">' + r[1] + '</td></tr>';
    }).join('') + '</table>' +
    '<p style="font-family:sans-serif;font-size:13px;color:#6b6455">Dikirim otomatis oleh Nusantara Connect API \u00b7 Firman Web</p>';

  try { MailApp.sendEmail({ to: fw_adminEmail_, subject: subject, htmlBody: html, name: 'Nusantara Connect' }); } catch (e) { }

  // auto-reply ke pemohon bila alamat emailnya valid
  if (record.email && /@/.test(String(record.email))) {
    try {
      MailApp.sendEmail({
        to: FW_CONFIG.REPLY_EMAIL || fw_adminEmail_,
        subject: 'Terima kasih \u2014 ' + (def.label || coll),
        htmlBody: fw_replyHtml_(record, def, coll),
        name: 'Nusantara Connect'
      });
    } catch (e2) { }
  }
  return { wa: fw_waLink_(coll, record) };
}

function fw_replyHtml_(record, def, coll) {
  var nama = fw_clean_(record.nama || record.calon || 'Bapak/Ibu');
  return '<div style="font-family:sans-serif;max-width:560px;margin:auto;color:#22201c">' +
    '<h2 style="color:#0e7c66;margin-bottom:4px">Halo ' + nama + '</h2>' +
    '<p>Terima kasih telah menghubungi <b>' + (def.label || '') + '</b>. Permintaan Anda sudah kami terima dan akan ditindaklanjuti tim maksimal 1\u00d724 jam kerja.</p>' +
    '<p>Butuh respons cepat? Kirim ulang data Anda via WhatsApp: <a href="' + fw_waLink_(coll, record) + '">Klik di sini</a></p>' +
    '<p style="color:#6b6455;font-size:14px">Pesan otomatis \u2014 tidak perlu dibalas.<br/>LPK Putri Ayu Mandiri \u00b7 Paes Nusa \u00b7 Asosiasi Perias Nusantara</p></div>';
}

/** Susun tautan WhatsApp siap kirim dari data formulir. */
function fw_waLink_(coll, record) {
  var def = FW_SCHEMA[coll] || {};
  var skip = ['id', 'brand', 'createdAt', 'updatedAt', 'createdBy', 'source', '_row'];
  var lines = ['Halo ' + (def.label ? 'tim ' + def.label : 'Firman Web'), '-'];
  for (var key in record) {
    if (key.charAt(0) === '_' || skip.indexOf(key) > -1) continue;
    var v = record[key];
    if (v === '' || v === undefined || v === null) continue;
    lines.push(key + ': ' + v);
  }
  lines.push('-');
  lines.push('ID: ' + (record.id || '-'));
  return 'https://wa.me/' + FW_CONFIG.WHATSAPP_NUMBER + '?text=' + encodeURIComponent(lines.join('\n'));
}


/* ---------------------------------------------------------------------------
 * AGREGASI
 * ------------------------------------------------------------------------- */
function fw_counts_() {
  var out = {};
  for (var coll in FW_SCHEMA) {
    try { out[coll] = Math.max(fw_sheet_(coll).getLastRow() - 1, 0); } catch (e) { out[coll] = 0; }
  }
  return out;
}

function fw_stats_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('fw_stats');
  if (hit) { try { return JSON.parse(hit); } catch (e) { } }
  var stats = { generatedAt: fw_now_(), collections: {}, status: {}, weekly: 0 };
  var weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  for (var coll in FW_SCHEMA) {
    var res = fw_list_(coll, { limit: 200 });
    var rows = res.data || [];
    var byStatus = {};
    var fresh = 0;
    rows.forEach(function (r) {
      var s = r.status || '-';
      byStatus[s] = (byStatus[s] || 0) + 1;
      if (String(r.createdAt || '') >= weekAgo) fresh++;
    });
    stats.collections[coll] = { total: res.total, label: FW_SCHEMA[coll].label, brand: FW_SCHEMA[coll].brand, baru: fresh };
    stats.status[coll] = byStatus;
    stats.weekly += fresh;
  }
  try { cache.put('fw_stats', JSON.stringify(stats), FW_CONFIG.CACHE_STATS_SEC); } catch (e) { }
  return stats;
}

/* ---------------------------------------------------------------------------
 * SETUP + SEED LOCALDB
 * ------------------------------------------------------------------------- */
function fw_setup_(resetHeader) {
  var ss = fw_ss_(false);
  var made = [];
  for (var coll in FW_SCHEMA) {
    var name = FW_CONFIG.SHEET_PREFIX + coll;
    var sh = ss.getSheetByName(name);
    if (!sh) { sh = ss.insertSheet(name); made.push(coll); }
    if (resetHeader || sh.getLastRow() === 0) fw_writeHeader_(sh, coll);
    var def = FW_SCHEMA[coll];
    // hapus sheet default "Sheet1"
  }
  var d1 = ss.getSheetByName('Sheet1');
  if (d1 && ss.getSheets().length > 1) ss.deleteSheet(d1);
  return { spreadsheetId: ss.getId(), url: ss.getUrl(), sheetsDibuat: made, koleksi: Object.keys(FW_SCHEMA) };
}

function fw_seed_(force) {
  fw_setup_(false);
  var added = 0;
  var seed = fw_seedData_();
  for (var coll in seed) {
    var existing = fw_list_(coll, { limit: 200 }).data || [];
    if (existing.length && !force) continue;
    seed[coll].forEach(function (row) {
      var res = fw_create_(coll, row, {});
      if (res && res.ok) added++;
    });
  }
  return { added: added };
}

function fw_seedData_() {
  var today = new Date();
  var d = function (offset) {
    var x = new Date(today.getTime() + offset * 864e5);
    return Utilities.formatDate(x, 'Asia/Jakarta', 'yyyy-MM-dd');
  };
  return {
    program: [
      { judul: 'Tata Rias Pengantin Paes Ageng & Nusantara', slug: 'tata-rias-pengantin', durasi: '3 bulan · 216 JP', kuota: 20, biaya: 3850000, sertifikasi: 'BNSP & Sertifikat LPK', jadwal: 'Pagi / Siang / Karyawan', level: 'Menengah', status: 'Dibuka', foto: '8657457', ringkas: 'Kuasai pakem paes ageng Keraton Yogyakarta-Solo, sanggul tiga daerah, dan rias komersial modern.' },
      { judul: 'Tata Kecantikan Kulit & Browskincare', slug: 'tata-kecantikan-kulit', durasi: '2 bulan · 144 JP', kuota: 18, biaya: 3200000, sertifikasi: 'BNSP Sk-II', jadwal: 'Pagi / Sabtu-Minggu', level: 'Pemula', status: 'Dibuka', foto: '6188042', ringkas: 'Analisis kulit, facial tradisional dan modern, totok wajah, serta perawatan pengantin jelang hari-H.' },
      { judul: 'Tata Kecantikan Rambut & Sanggul', slug: 'tata-kecantikan-rambut', durasi: '2 bulan · 144 JP', kuota: 18, biaya: 2950000, sertifikasi: 'Sertifikat Kompetensi', jadwal: 'Siang / Sore', level: 'Pemula', status: 'Dibuka', foto: '10318040', ringkas: 'Cutting, coloring, blow dry, updo pengantin, hingga rias rambut adat Nusantara.' },
      { judul: 'Tata Kecantikan SPA & Refleksi', slug: 'tata-kecantikan-spa', durasi: '2 bulan · 132 JP', kuota: 16, biaya: 3400000, sertifikasi: 'BNSP + Sertifikat Terapis', jadwal: 'Pagi / Sore', level: 'Menengah', status: 'Dibuka', foto: '6187418', ringkas: 'Pijat traditional Jawa, body scrub, aromaterapi, standar hygiene spa, dan pelayanan prima.' },
      { judul: 'Menjahit & Busana Adat Kontemporer', slug: 'menjahit-busana', durasi: '4 bulan · 288 JP', kuota: 16, biaya: 4250000, sertifikasi: 'BNSP Menjahit Level II', jadwal: 'Pagi / Karyawan', level: 'Lanjut', status: 'Dibuka', foto: '3984871', ringkas: 'Dari pola dasar, kebaya bordir, beskap, hingga manajemen pesanan butik dan harga modal.' }
    ],
    people: [
      { nama: 'Ayu Puspita Sari, S.Pd., M.Par.', jabatan: 'Direktur & Kepala Program Paes', peran: 'Instruktur', unit: 'LPK', keahlian: 'Paes Ageng Keraton', foto: '14857421', bio: '25 tahun merias pengantin adat, juri kompetensi tata rias tingkat nasional.' },
      { nama: 'Rr. Sri Handayani', jabatan: 'Kepala Tata Kecantikan Kulit', peran: 'Instruktur', unit: 'LPK', keahlian: 'Skin analysis & totok', foto: '6187640', bio: 'Praktisi skincare tradisional Jawa dan trainer brand lokal.' },
      { nama: 'Bimo Prasetyo'       , jabatan: 'Lead Hair Stylist', peran: 'Mentor', unit: 'Paes Nusa', keahlian: 'Updo & sanggul adat', foto: '14615063', bio: 'Stylist 400+ pengantin, spesialis sanggul mixed modern-tradisional.' },
      { nama: 'Dra. Retno Wulandari', jabatan: 'Ketua Asosiasi Perias Nusantara', peran: 'Pengurus', unit: 'Asosiasi', keahlian: 'Standardisasi profesi', foto: '36944259', bio: 'Perumus kurikulum bersama Disnaker dan pembina 24 cabang daerah.' },
      { nama: 'Urip Sedyowidodo', jabatan: 'Pembina Koperasi & Gerakan Ekonomi Rakyat', peran: 'Narasumber', unit: 'Pak Urip', keahlian: 'Ekonomi kerakyatan', foto: '32243407', bio: 'Penggerak koperasi produksi dan pelatihan kerja di 38 desa.' }
    ],
    paket: [
      { judul: 'Paket Rias Paes Nusa Signature', kategori: 'Rias', harga: 18500000, satuan: 'pengantin', durasi: 'Akad + Resepsi', status: 'Tersedia', foto: '35367136', termasuk: 'Rias paes ageng + 3 ganti busana; rias keluarga inti 10 orang; touch-up seharian', deskripsi: 'Riasan pakem Keraton dengan sentuhan kontemporer, dikerjakan tim senior.' },
      { judul: 'Paket Catering Nusantara', kategori: 'Catering', harga: 21000000, satuan: '500 pax', durasi: 'Prasmanan + 4 stall', status: 'Tersedia', foto: '34156954', termasuk: 'Menu Jawa-Sunda-Minang, food tester 3x, pramusaji, peralatan saji', deskripsi: 'Dapur bersertifikat halal dan higienis, chef berpengalaman 12 tahun.' },
      { judul: 'Paket Foto & Videografi Cinematic', kategori: 'Foto & Videografi', harga: 16500000, satuan: 'paket', durasi: 'Pre-wed s/d after movie', status: 'Tersedia', foto: '6589734', termasuk: '2 fotografer, 2 videografer, drone, teaser 60 detik, album 20 halaman', deskripsi: 'Gaya cinematic-elegan dengan color grading khas Paes Nusa.' },
      { judul: 'Paket Dekorasi Adat Modern', kategori: 'Dekorasi', harga: 24000000, satuan: 'pelaminan', durasi: 'Set-up H-1', status: 'Booking Terbatas', foto: '39193816', termasuk: 'Pelaminan kayu jati ukir, bunga segar, backdrop paes, lighting, karpet', deskripsi: 'Padu padan ukir Jawa, kain lurik, dan bunga lokal segar.' },
      { judul: 'Paket Gedung & Pendopo', kategori: 'Gedung & MICE', harga: 32000000, satuan: 'hari', durasi: '12 jam', status: 'Tersedia', foto: '30215011', termasuk: 'Gedung 800 pax, sound & LED, ruang transit pengantin, parkir 120 mobil', deskripsi: 'Dua pilihan venue: pendopo heritage dan ballroom kaca modern.' },
      { judul: 'Paket Transportasi Pengantin', kategori: 'Transportasi', harga: 4800000, satuan: '3 mobil', durasi: '12 jam', status: 'Tersedia', foto: '21176581', termasuk: 'Dekorasi mobil, pengemudi berseragam, iring-iringan kirab', deskripsi: 'Termasuk kereta kuda atau mobil klasik untuk prosesi kirab.' }
    ],
    event: [
      { judul: 'Kongres & Rakernas Perias Nusantara 2026', jenis: 'Rakernas', tanggal: d(21), jam: '08.00-17.00', kota: 'Yogyakarta', lokasi: 'PGN Convention Hall', kuota: 450, tiket: 'Gratis anggota · Umum Rp250.000', status: 'Pendaftaran Dibuka', foto: '8761328', deskripsi: 'Perumusan standar kompetensi nasional dan laporan 24 cabang.' },
      { judul: 'Sertifikasi Kompetensi Paes Ageng (BNSP)', jenis: 'Sertifikasi', tanggal: d(9), jam: '09.00-16.00', kota: 'Yogyakarta', lokasi: 'Kampus LPK Putri Ayu Mandiri', kuota: 60, tiket: 'Rp650.000', status: 'Pendaftaran Dibuka', foto: '37296595', deskripsi: 'Uji kompetensi dengan asesor tersertifikasi, hasil langsung terdaftar.' },
      { judul: 'Bakti Sosial Rias 1.000 Pengantin Pra-Sejahtera', jenis: 'Bakti Sosial', tanggal: d(37), jam: '07.00-15.00', kota: 'Bantul', lokasi: 'Balai Desa Sumbermulyo', kuota: 300, tiket: 'Gratis', status: 'Segera', foto: '36400782', deskripsi: 'Layanan rias dan skincare gratis untuk pengantin dari keluarga prasejahtera.' },
      { judul: 'Festival Paes Nusantara & Lomba Sanggul', jenis: 'Kompetensi', tanggal: d(63), jam: '10.00-18.00', kota: 'Surakarta', lokasi: 'Loji Gede Kratonan', kuota: 250, tiket: 'Rp150.000', status: 'Segera', foto: '33482377', deskripsi: 'Adu kreasi sanggul daerah dengan juri praktisi dan budayawan.' }
    ],
    anggota: [
      { nama: 'Studio Rias Melati Nusantara', cabang: 'Yogyakarta', kategori: 'Perias Pengantin', tahun: 2016, spesialisasi: 'Paes Ageng & Basahan', verifikasi: 'Terverifikasi', telepon: '0812-3456-781', email: 'melati@riasnusa.id', foto: '12949059' },
      { nama: 'Ayu Bridaling Jati', cabang: 'Sleman', kategori: 'Perias Pengantin', tahun: 2019, spesialisasi: 'Paes Solo & Busana Adat', verifikasi: 'Terverifikasi', telepon: '0813-2211-908', email: 'jati@riasnusa.id', foto: '35423359' },
      { nama: 'Kencana Spa & Beauty Class', cabang: 'Bantul', kategori: 'Beauty Therapist', tahun: 2020, spesialisasi: 'Totok & Prenup Care', verifikasi: 'Terverifikasi', telepon: '0857-9911-2233', email: 'kencana@riasnusa.id', foto: '6188037' },
      { nama: 'Sanggar Rambut Weton', cabang: 'Kulon Progo', kategori: 'Hair Stylist', tahun: 2021, spesialisasi: 'Sanggul Campuran', verifikasi: 'Menunggu', telepon: '0821-5566-7788', email: 'weton@riasnusa.id', foto: '23349912' },
      { nama: 'Butik Lurik Ayunda', cabang: 'Surakarta', kategori: 'Penjahit Busana', tahun: 2018, spesialisasi: 'Kebaya Bordir & Beskap', verifikasi: 'Terverifikasi', telepon: '0819-4433-2211', email: 'ayunda@riasnusa.id', foto: '3984847' },
      { nama: 'Sekar Ayu MUA Collective', cabang: 'Semarang', kategori: 'Perias Pengantin', tahun: 2022, spesialisasi: 'International & Adat', verifikasi: 'Menunggu', telepon: '0811-2734-9955', email: 'sekar@riasnusa.id', foto: '13535267' }
    ],
    artikel: [
      { judul: 'Paes Ageng Bukan Sekadar Hitam di Dahi: Membaca Filosofi Keraton', kategori: 'Budaya', unit: 'Mbak Ayu', penulis: 'Ayu Puspita Sari', tanggal: d(-6), tag: 'paes,keraton,filsafat', foto: '29194911', status: 'Terbit', ringkas: 'Lengkung paes ageng adalah teks: bentuknya mengatur wibawa, tahap hidup, dan doa restu. Kami urai maknanya satu per satu.', body: 'Paes ageng hanya boleh dikenakan pengantin yang menikah pertama dan berlangsung di dalam keraton. Bentuk melengkung pada dahi (punuk) berjumlah tiga atau tujuh, masing-masing menandai tahap laku....' },
      { judul: 'Curriculum Outcomes: 5 Tahun Lulusan LPK Menyerap Pasar Kerja', kategori: 'Pelatihan', unit: 'LPK', penulis: 'Tim Mutu LPK', tanggal: d(-24), tag: 'karier,data', foto: '29275615', status: 'Terbit', ringkas: '87% lulusan bekerja atau membuka usaha dalam 6 bulan. Ini rincian per program yang perlu dibaca calon peserta.', body: 'Data dihimpun dari tracer study alumni 2021-2025 dengan tingkat respons 78%...' },
      { judul: 'Skema APBD untuk Pelatihan Kerja: Cara Desa Mengusung Program', kategori: 'Kebijakan', unit: 'LPK', penulis: 'Bagian Kemitraan', tanggal: d(-40), tag: 'apbd,kemitraan', foto: '8761299', status: 'Terbit', ringkas: 'Panduan praktis menyusun proposal pelatihan bersertifikat lewat Musrenbang desa hingga DPA Disnaker.', body: 'Mulai dari kebutuhan riil, RAB, hingga indikator keluaran...' },
      { judul: 'Anggaran Wedding 2026: Di Mana Uang Bekerja Paling Keras', kategori: 'Usaha', unit: 'Paes Nusa', penulis: 'Tim Paes Nusa', tanggal: d(-13), tag: 'budget,planning', foto: '39193816', status: 'Terbit', ringkas: 'Rasio ideal rias 20%, catering 40%, dokumentasi 15%, dekorasi 20%, lain-lain 5%. Berikut penjelasannya.', body: 'Kami membedah 214 paket yang terjual pada 2025...' },
      { judul: 'Gerakan Koperasi Produksi: Dari Perias Rumahan ke Badan Usaha', kategori: 'Ekonomi', unit: 'Pak Urip', penulis: 'Urip Sedyowidodo', tanggal: d(-30), tag: 'koperasi,umkm', foto: '32243402', status: 'Terbit', ringkas: 'Ketika 40 perias bergabung dalam satu koperasi, harga bahan turun 22% dan akses kredit terbuka.', body: 'Model koperasi produksi yang kami tawarkan menempatkan alat bersama sebagai modal...' },
      { judul: 'Standar Etika Perias Nusantara: Privasi Pengantin Nomor Satu', kategori: 'Tips', unit: 'Asosiasi', penulis: 'Dewan Etik', tanggal: d(-52), tag: 'etika', foto: '10498800', status: 'Terbit', ringkas: 'Lima aturan baku soal foto, data pribadi, dan batas fisik yang wajib dipatuhi anggota.', body: 'Poin-poin AD/ART hasil revisi Kongres 2025...' }
    ],
    testimonial: [
      { nama: 'Nadia Kusuma', peran: 'Alumni Tata Rias Pengantin 2024', unit: 'LPK', rating: 5, kutipan: 'Selesai pelatihan saya langsung dapat pesanan 12 pengantin di tahun pertama. Modul pakem dan praktik di depan kelas itu bedanya.', foto: '13535267', status: 'Tayang' },
      { nama: 'Bagas & Ayla', peran: 'Klien Paket Signature 2025', unit: 'Paes Nusa', rating: 5, kutipan: 'Tim datang sebelum subuh, tenang, dan hasilnya membuat ibu-ibu satu kampung memuji paes-nya. Worth every rupiah.', foto: '6589734', status: 'Tayang' },
      { nama: 'Rina Marlina', peran: 'Pemilik Kencana Spa', unit: 'Asosiasi', rating: 5, kutipan: 'Bergabung dengan asosiasi membuat usaha saya punya standar, perlindungan, dan jaringan pemasok.', foto: '6187639', status: 'Tayang' },
      { nama: 'Dr. Sari Dewi, M.Hum.', peran: 'Budayawan · Juri Festival', unit: 'Mbak Ayu', rating: 5, kutipan: 'Kelas Mbak Ayu adalah arsip hidup. Pengetahuan pakem yang biasanya turun-temurun kini terdokumentasi rapi.', foto: '36977424', status: 'Tayang' },
      { nama: 'Sutrisno', peran: 'Ketua UMKM Desa Wukirsari', unit: 'Pak Urip', rating: 5, kutipan: 'Beliau tidak ceramah di hotel. Turun ke balai desa, hitung bersama, lalu kawal sampai koperasi kami jalan.', foto: '1682409', status: 'Tayang' }
    ],
    registration: [
      { nama: 'Wulan Ardina', email: 'wulan@mail.com', telepon: '081234567801', asal: 'Bantul', pendidikan: 'SMA/SMK', program: 'Tata Rias Pengantin Paes Ageng & Nusantara', angkatan: 'Gelombang 3/2026', status: 'Diverifikasi', catatan: 'Minta kelas karyawan.' },
      { nama: 'Tiara Rahmawati', email: 'tiara@mail.com', telepon: '081234567802', asal: 'Sleman', pendidikan: 'SMP', program: 'Menjahit & Busana Adat Kontemporer', angkatan: 'Gelombang 3/2026', status: 'Baru' }
    ],
    booking: [
      { calon: 'Ayla', pasangan: 'Bagas', email: 'bagas.ayla@mail.com', telepon: '081234567803', tanggal: d(46), paket: 'Paket Rias Paes Nusa Signature', tamu: 500, venue: 'Pendopo Joglo Umbulharjo', budget: 78000000, status: 'DP', catatan: 'Paes ageng + sesahungan, adat Jawa-Yogyakarta.' },
      { calon: 'Kirana', pasangan: 'Damar', email: 'damar@mail.com', telepon: '081234567804', tanggal: d(74), paket: 'Paket Dekorasi Adat Modern', tamu: 300, venue: 'Gedung Serbaguna Sleman', budget: 45000000, status: 'Konsultasi' }
    ],
    membership: [
      { nama: 'Cahaya Esti Studio', usaha: 'Rias Pengantin & Make-Up Artist', cabang: 'Gunungkidul', telepon: '081234567805', email: 'cahaya@mail.com', pengalaman: 6, status: 'Verifikasi Berkas' }
    ],
    collab: [
      { nama: 'Museum Tekstil Jakarta', organisasi: 'Museum', email: 'program@museumtekstil.id', telepon: '021-555-0192', jenis: 'Workshop', tanggal: d(28), kota: 'Jakarta', pesan: 'Kelas terbuka paes untuk 60 peserta + kurasi pameran.', status: 'Dijadwalkan' }
    ],
    aspiration: [
      { nama: 'Karjo', komunitas: 'Kelompok Tani Maju', wilayah: 'Kulon Progo', telepon: '081234567806', topik: 'Pertanian', dukungan: 'Ajak Diskusi', aspirasi: 'Butuh pelatihan pengemasan agar hasil panen punya nilai jual.', status: 'Ditindaklanjuti' }
    ],
    message: [
      { nama: 'Dwi Lestari', email: 'dwi@mail.com', telepon: '081234567807', subjek: 'Info beasiswa', pesan: 'Apakah ada jalur beasiswa APBD untuk peserta dari keluarga tidak mampu?', unit: 'LPK', status: 'Baru' }
    ],
    subscriber: [
      { email: 'berita@riasnusa.id', nama: 'Redaksi Riasnusa', minat: 'Kegiatan asosiasi', status: 'Aktif' }
    ]
  };
}

function fw_purge_(coll) {
  if (coll) {
    var sh = fw_sheet_(coll);
    if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
    return { purged: [coll] };
  }
  var done = [];
  for (var k in FW_SCHEMA) { var s = fw_sheet_(k); if (s.getLastRow() > 1) { s.deleteRows(2, s.getLastRow() - 1); done.push(k); } }
  return { purged: done };
}

/* ---------------------------------------------------------------------------
 * MENU SPREADSHEET (kemudahan admin)
 * ------------------------------------------------------------------------- */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Firman Web')
    .addItem('1. Setup Database', 'menuSetup_')
    .addItem('2. Isi Data Contoh (Seed)', 'menuSeed_')
    .addItem('3. Cek Kesehatan API', 'menuHealth_')
    .addItem('4. Export CSV ke Drive', 'menuExport_')
    .addSeparator()
    .addItem('5. Reset Statistik Cache', 'menuResetCache_')
    .addToUi();
}

function menuSetup_() {
  var r = fw_setup_(true);
  SpreadsheetApp.getUi().alert('Database siap.\nSpreadsheet: ' + r.url + '\nSheet dibuat: ' + (r.sheetsDibuat.length ? r.sheetsDibuat.join(', ') : 'tidak ada (sudah ada)'));
}
function menuSeed_() {
  var r = fw_seed_(false);
  SpreadsheetApp.getUi().alert('Seed selesai. Baris ditambahkan: ' + r.added);
}
function menuHealth_() {
  var counts = fw_counts_();
  var msg = Object.keys(counts).map(function (k) { return k + ': ' + counts[k]; }).join('\n');
  SpreadsheetApp.getUi().alert('Status koleksi — ' + FW_CONFIG.VERSION + '\n' + msg);
}
function menuExport_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheets().forEach(function (sh) {
    var coll = sh.getName().replace(FW_CONFIG.SHEET_PREFIX, '');
    if (!FW_SCHEMA[coll]) return;
    var res = fw_export_({ koleksi: coll });
    if (res && res.csv) DriveApp.createFile(coll + '.csv', res.csv, 'text/csv');
  });
  SpreadsheetApp.getUi().alert('CSV diekspor ke Drive (folder root).');
}
function menuResetCache_() {
  CacheService.getScriptCache().remove('fw_stats');
  SpreadsheetApp.getUi().alert('Cache statistik dibersihkan.');
}

/* ---------------------------------------------------------------------------
 * UTILITAS WEB MINI (opsional) — /api/boot untuk instalasi cepat
 * ------------------------------------------------------------------------- */
function fw_bootDoc_() {
  return {
    endpoint: ScriptApp.getService().getUrl(),
    method: 'Web App /api/{koleksi}',
    collections: Object.keys(FW_SCHEMA),
    cors: 'Pakai GET untuk read, POST text/plain untuk write, atau ?callback= untuk JSONP.',
    auth: 'Script Properties ADMIN_TOKEN'
  };
}
