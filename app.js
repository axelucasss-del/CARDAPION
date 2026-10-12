/* ============================================================
   GAMAA BURGUER – APP.JS  |  Data layer + theme engine
   ============================================================ */

const STORAGE_MENU   = 'gamaa_menu';
const STORAGE_CONFIG = 'gamaa_config';
const STORAGE_CATS   = 'gamaa_categories';
const STORAGE_CAT_ORDER = 'gamaa_cat_order';

/* ─── SUPABASE REMOTE PERSISTENCE ─────────────────────────── */
let gamaaSupabase = null;
let _remoteReady = false;
let _remoteSaveTimer = null;
let _remoteLoadInProgress = false;
let _remoteSubscription = null;
const REMOTE_TABLE = 'site_data';
const REMOTE_ID = 1;

function getSupabaseClient() {
  if (gamaaSupabase) return gamaaSupabase;
  let url = (window.GAMAA_SUPABASE_URL || '').trim();
  url = url.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
  const key = (window.GAMAA_SUPABASE_KEY || '').trim();
  if (!window.supabase || !url.startsWith('https://') || !key || key.startsWith('COLE_AQUI')) return null;
  gamaaSupabase = window.supabase.createClient(url, key);
  return gamaaSupabase;
}

function readLocalSnapshot() {
  return {
    id: REMOTE_ID,
    config: JSON.parse(localStorage.getItem(STORAGE_CONFIG) || 'null') || { ...DEFAULT_CONFIG },
    categories: JSON.parse(localStorage.getItem(STORAGE_CATS) || 'null') || deepClone(DEFAULT_CATEGORIES),
    menu: JSON.parse(localStorage.getItem(STORAGE_MENU) || 'null') || {},
    cat_order: JSON.parse(localStorage.getItem(STORAGE_CAT_ORDER) || 'null') || [...DEFAULT_CAT_ORDER],
    updated_at: new Date().toISOString()
  };
}

function writeLocalSnapshot(row) {
  if (row.config && Object.keys(row.config).length) localStorage.setItem(STORAGE_CONFIG, JSON.stringify(row.config));
  if (row.categories && Object.keys(row.categories).length) localStorage.setItem(STORAGE_CATS, JSON.stringify(row.categories));
  if (row.menu && Object.keys(row.menu).length) localStorage.setItem(STORAGE_MENU, JSON.stringify(row.menu));
  if (Array.isArray(row.cat_order) && row.cat_order.length) localStorage.setItem(STORAGE_CAT_ORDER, JSON.stringify(row.cat_order));
}

async function persistRemoteState(showErrors = false) {
  const client = getSupabaseClient();
  if (!client || !_remoteReady) return;
  const snapshot = readLocalSnapshot();
  const { error } = await client.from(REMOTE_TABLE).upsert(snapshot, { onConflict: 'id' });
  if (error) {
    console.error('Erro ao salvar no Supabase:', error);
    if (showErrors && typeof showToast === 'function') showToast('Não foi possível salvar online. Confira o login e as políticas do Supabase.', 'error');
    return false;
  }
  return true;
}

function scheduleRemoteSave() {
  if (!_remoteReady) return;
  clearTimeout(_remoteSaveTimer);
  _remoteSaveTimer = setTimeout(() => persistRemoteState(true), 350);
}

function subscribeToRemoteChanges() {
  const client = getSupabaseClient();
  if (!client || _remoteSubscription) return;
  _remoteSubscription = client.channel('gamaa-site-data-live')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: REMOTE_TABLE, filter: 'id=eq.1' }, async (payload) => {
      // Não recarrega o painel administrativo enquanto ele próprio salva alterações.
      if (sessionStorage.getItem('gamaa_admin') === '1') return;
      if (!payload.new) return;
      writeLocalSnapshot(payload.new);
      localStorage.setItem('gamaa_remote_hydrated', '1');
      location.reload();
    })
    .subscribe();
}

async function initializeRemotePersistence() {
  if (_remoteLoadInProgress) return;
  _remoteLoadInProgress = true;
  const client = getSupabaseClient();
  if (!client) {
    console.warn('Supabase não configurado. O site continuará usando armazenamento local até configurar supabase-config.js.');
    return;
  }
  try {
    const { data, error } = await client.from(REMOTE_TABLE).select('*').eq('id', REMOTE_ID).maybeSingle();
    if (error) throw error;
    const remoteHasData = data && data.menu && Object.keys(data.menu).length > 0;
    if (remoteHasData) {
      const localLooksDefault = !localStorage.getItem('gamaa_remote_hydrated');
      writeLocalSnapshot(data);
      localStorage.setItem('gamaa_remote_hydrated', '1');
      _remoteReady = true;
      subscribeToRemoteChanges();
      // Recarrega uma única vez para que as páginas existentes renderizem os dados remotos.
      if (localLooksDefault && !sessionStorage.getItem('gamaa_remote_reload')) {
        sessionStorage.setItem('gamaa_remote_reload', '1');
        location.reload();
        return;
      }
      sessionStorage.removeItem('gamaa_remote_reload');
    } else {
      // Primeira configuração: usa os dados locais atuais como carga inicial.
      const { error: saveError } = await client.from(REMOTE_TABLE).upsert(readLocalSnapshot(), { onConflict: 'id' });
      if (saveError) throw saveError;
      localStorage.setItem('gamaa_remote_hydrated', '1');
      _remoteReady = true;
      subscribeToRemoteChanges();
    }
  } catch (err) {
    console.error('Não foi possível sincronizar o cardápio com o Supabase:', err);
    _remoteLoadInProgress = false;
    // Não apaga dados locais quando o backend estiver indisponível ou sem políticas.
  }
}

async function deleteStoredAsset(publicUrl, bucket = 'cardapio-imagens') {
  try {
    const client = getSupabaseClient();
    if (!client || !publicUrl) return;
    const marker = `/storage/v1/object/public/${bucket}/`;
    const index = publicUrl.indexOf(marker);
    if (index < 0) return;
    const path = decodeURIComponent(publicUrl.slice(index + marker.length).split('?')[0]);
    if (path) {
      const { error } = await client.storage.from(bucket).remove([path]);
      if (error) console.warn('Não foi possível remover arquivo do Storage:', error);
    }
  } catch (error) { console.warn('Falha ao remover arquivo do Storage:', error); }
}

function uploadDataUrlToStorage(dataUrl, folder = 'imagens') {
  return new Promise(async (resolve, reject) => {
    try {
      const client = getSupabaseClient();
      if (!client || !dataUrl || !dataUrl.startsWith('data:')) return resolve(dataUrl);
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '');
      const path = `${folder}/${crypto.randomUUID()}.${ext}`;
      const { error } = await client.storage.from('cardapio-imagens').upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
      if (error) throw error;
      const { data } = client.storage.from('cardapio-imagens').getPublicUrl(path);
      resolve(data.publicUrl);
    } catch (err) {
      console.error('Falha ao enviar imagem para o Storage:', err);
      reject('Não foi possível enviar a imagem online. Confirme o login e o bucket cardapio-imagens.');
    }
  });
}

/* ─── DEFAULTS ────────────────────────────────────────────── */

const DEFAULT_CONFIG = {
  siteName:      'GAMAA',
  siteSub:       'BURGUER',
  heroTag:       '🔥 O melhor da cidade',
  heroTitle:     'CARDÁPIO',
  heroHighlight: 'GAMAA BURGUER',
  heroSubtitle:  'Escolha sua categoria e monte o seu pedido perfeito.',
  instagram:     'https://www.instagram.com/gamaa_burguer/',
  whatsapp:      '',
  primaryColor:  '#e8002d',
  accentColor:   '#ffc400',
  bgColor:       '#0d0d0d',
  cardColor:     '#1a1a1a',
  logoEmoji:     '🍔',
  logoImage:     '',
  heroBgImage:   '',
  footerText:    '© 2026 Gamaa Burguer · Todos os direitos reservados',
};

const DEFAULT_CATEGORIES = {
  entradas:     { label:'Entradas',     icon:'🥗', description:'Aperitivos & petiscos irresistíveis para começar bem',         photo:'' },
  hamburgueres: { label:'Hambúrgueres', icon:'🍔', description:'Smash burgers artesanais com ingredientes selecionados',        photo:'' },
  combos:       { label:'Combos',       icon:'🍟', description:'Combinações especiais com o melhor custo-benefício',            photo:'' },
  sobremesas:   { label:'Sobremesas',   icon:'🍰', description:'Doces irresistíveis para encerrar com chave de ouro',           photo:'' },
  bebidas:      { label:'Bebidas',      icon:'🥤', description:'Refrescantes opções para acompanhar seu pedido',                photo:'' },
};

const DEFAULT_CAT_ORDER = ['entradas','hamburgueres','combos','sobremesas','bebidas'];

function getCatOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_CAT_ORDER));
    if (Array.isArray(saved) && saved.length > 0) return saved;
  } catch { /* ignore */ }
  return [...DEFAULT_CAT_ORDER];
}

function saveCatOrder(order) {
  try {
    localStorage.setItem(STORAGE_CAT_ORDER, JSON.stringify(order));
    scheduleRemoteSave();
  } catch (e) {
    console.error('Erro ao salvar ordem das categorias:', e);
    showToast('Aviso: Armazenamento cheio no navegador.', 'error');
  }
}

// Compatibilidade: CAT_ORDER como getter global dinâmico para não quebrar referências
if (typeof window !== 'undefined') {
  try {
    Object.defineProperty(window, 'CAT_ORDER', {
      get() { return getCatOrder(); },
      configurable: true
    });
  } catch {
    window.CAT_ORDER = DEFAULT_CAT_ORDER;
  }
}

/* ─── SITE CONFIG ─────────────────────────────────────────── */

function getSiteConfig() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_CONFIG));
    return Object.assign({}, DEFAULT_CONFIG, s || {});
  } catch { return { ...DEFAULT_CONFIG }; }
}

function saveSiteConfig(data) {
  try {
    localStorage.setItem(STORAGE_CONFIG, JSON.stringify(data));
    scheduleRemoteSave();
  } catch (e) {
    console.error('Erro ao salvar configuração:', e);
    showToast('Aviso: Armazenamento cheio no navegador.', 'error');
  }
}

/* ─── CATEGORY CONFIG ─────────────────────────────────────── */

function getCategoryConfig() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_CATS));
    if (s && typeof s === 'object' && Object.keys(s).length > 0) {
      return s;
    }
  } catch { /* ignore */ }
  return deepClone(DEFAULT_CATEGORIES);
}

function saveCategoryConfig(data) {
  try {
    localStorage.setItem(STORAGE_CATS, JSON.stringify(data));
    scheduleRemoteSave();
  } catch (e) {
    console.error('Erro ao salvar categorias:', e);
    showToast('Aviso: Armazenamento cheio no navegador.', 'error');
  }
}

/* ─── MENU DATA ───────────────────────────────────────────── */

function getMenu() {
  try { return JSON.parse(localStorage.getItem(STORAGE_MENU)) || {}; }
  catch { return {}; }
}

function saveMenu(data) {
  try {
    localStorage.setItem(STORAGE_MENU, JSON.stringify(data));
    scheduleRemoteSave();
  } catch (e) {
    console.error('Erro ao salvar menu:', e);
    showToast('Aviso: Armazenamento cheio no navegador.', 'error');
  }
}

function getCategoryItems(cat) { return getMenu()[cat] || []; }

function saveCategoryItems(cat, items) {
  const m = getMenu();
  m[cat] = items;
  saveMenu(m);
}

/* ─── UTILS ───────────────────────────────────────────────── */

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

/* ─── THEME ENGINE ────────────────────────────────────────── */

function applyTheme(cfg) {
  if (!cfg) cfg = getSiteConfig();
  const root = document.documentElement;
  const primary  = cfg.primaryColor || '#e8002d';
  const accent   = cfg.accentColor  || '#ffc400';
  const bg       = cfg.bgColor      || '#0d0d0d';
  const card     = cfg.cardColor    || '#1a1a1a';

  root.style.setProperty('--primary',      primary);
  root.style.setProperty('--primary-dark', darkenHex(primary, 28));
  root.style.setProperty('--gold',         accent);
  root.style.setProperty('--bg',           bg);
  root.style.setProperty('--bg2',          lightenHex(bg, 5));
  root.style.setProperty('--bg3',          lightenHex(bg, 10));
  root.style.setProperty('--card',         card);
  root.style.setProperty('--border',       lightenHex(bg, 22));
  root.style.setProperty('--text',         isLight(bg) ? '#111' : '#f0f0f0');
  root.style.setProperty('--muted',        isLight(bg) ? '#555' : '#888');

  const rgb = hexToRgb(primary);
  if (rgb) root.style.setProperty('--primary-rgb', `${rgb.r},${rgb.g},${rgb.b}`);

  const acRgb = hexToRgb(accent);
  if (acRgb) root.style.setProperty('--accent-rgb', `${acRgb.r},${acRgb.g},${acRgb.b}`);
}

/* ─── COLOR UTILITIES ─────────────────────────────────────── */

function hexToRgb(hex) {
  const c = hex.replace('#','');
  if (c.length !== 6) return null;
  return { r:parseInt(c.slice(0,2),16), g:parseInt(c.slice(2,4),16), b:parseInt(c.slice(4,6),16) };
}

function rgbToHex(r,g,b) {
  return '#' + [r,g,b].map(v => Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
}

function darkenHex(hex, amt) {
  const c = hexToRgb(hex); if (!c) return hex;
  return rgbToHex(c.r - amt, c.g - amt, c.b - amt);
}

function lightenHex(hex, amt) {
  const c = hexToRgb(hex); if (!c) return hex;
  return rgbToHex(c.r + amt, c.g + amt, c.b + amt);
}

function isLight(hex) {
  const c = hexToRgb(hex); if (!c) return false;
  // Perceived brightness
  return (c.r * 299 + c.g * 587 + c.b * 114) / 1000 > 128;
}

/* ─── TOAST ───────────────────────────────────────────────── */

function showToast(msg, type = 'success') {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const icon = type === 'success' ? 'fa-circle-check' : 'fa-circle-xmark';
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<i class="fa ${icon}"></i> <span>${msg}</span>`;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transform='translateY(10px)'; }, 3000);
  setTimeout(() => t.remove(), 3400);
}

/* ─── VIDEO HELPERS ───────────────────────────────────────── */

function getEmbedUrl(url) {
  if (!url) return null;
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}?rel=0`;
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  if (url.match(/\.(mp4|webm|ogg)(\?.*)?$/i)) return url;
  return null;
}

function buildVideoElement(url) {
  const embed = getEmbedUrl(url);
  if (!embed) return null;
  if (embed.includes('youtube') || embed.includes('vimeo')) {
    const el = document.createElement('iframe');
    el.src = embed;
    el.allowFullscreen = true;
    el.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    el.frameBorder = '0';
    return el;
  }
  const el = document.createElement('video');
  el.src = embed; el.controls = true; el.muted = true; el.loop = true; el.playsInline = true;
  return el;
}

/* ─── FORMAT PRICE ────────────────────────────────────────── */

function formatPrice(val) {
  if (!val && val !== 0) return '';
  const n = parseFloat(String(val).replace(',','.'));
  return isNaN(n) ? val : 'R$\u00a0' + n.toFixed(2).replace('.',',');
}

/* ─── INDEXEDDB – VIDEO STORAGE ───────────────────────────── */
// localStorage suporta apenas ~5MB. Vídeos MP4 podem ter centenas de MB.
// Armazenamos os blobs de vídeo no IndexedDB (sem limite prático de tamanho).

const _VIDEO_DB_NAME = 'gamaa_videos_db';
const _VIDEO_STORE   = 'videos';

function _openVideoDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_VIDEO_DB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(_VIDEO_STORE, { keyPath: 'id' });
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function saveVideoToDb(id, blob) {
  const db = await _openVideoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(_VIDEO_STORE, 'readwrite');
    tx.objectStore(_VIDEO_STORE).put({ id, blob });
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}

async function getVideoFromDb(id) {
  const db = await _openVideoDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(_VIDEO_STORE, 'readonly').objectStore(_VIDEO_STORE).get(id);
    req.onsuccess = e => resolve(e.target.result ? e.target.result.blob : null);
    req.onerror   = e => reject(e.target.error);
  });
}

async function deleteVideoFromDb(id) {
  if (!id) return;
  try {
    const db = await _openVideoDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(_VIDEO_STORE, 'readwrite');
      tx.objectStore(_VIDEO_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e.target.error);
    });
  } catch { /* ignora */ }
}

/**
 * Resolve a URL de vídeo definitiva de um item:
 * - item.videoDbId  → busca Blob no IndexedDB → cria ObjectURL temporário
 * - item.videoUrl   → usa getEmbedUrl (YouTube / Vimeo / .mp4 direto)
 * - nenhum          → null
 */
async function resolveVideoSrc(item) {
  if (item && item.videoDbId) {
    try {
      const blob = await getVideoFromDb(item.videoDbId);
      if (blob) return URL.createObjectURL(blob);
    } catch { /* segue */ }
  }
  return (item && item.videoUrl) ? (getEmbedUrl(item.videoUrl) || null) : null;
}

/* ─── IMAGE FILE READER (AUTO-COMPRESS & RESIZE VIA CANVAS) ─── */

function readImageFile(file, maxDimension = 1200, quality = 0.8) {
  return new Promise((resolve, reject) => {
    if (!file) { resolve(null); return; }

    const isImg = (file.type && file.type.startsWith('image/')) ||
                  /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name || '');
    if (!isImg) {
      reject('Arquivo selecionado não é uma imagem válida.');
      return;
    }

    // Accept images up to 25MB (smartphones / high-res cameras)
    if (file.size > 25 * 1024 * 1024) {
      reject('Imagem muito pesada (máximo 25MB).');
      return;
    }

    // Support legacy maxMB parameter (e.g. readImageFile(file, 1))
    if (typeof maxDimension === 'number' && maxDimension <= 50) {
      if (maxDimension <= 1) maxDimension = 600;
      else if (maxDimension >= 3) maxDimension = 1600;
      else maxDimension = 1200;
    }

    const reader = new FileReader();
    reader.onerror = () => reject('Erro ao ler arquivo de imagem.');
    reader.onload = e => {
      const img = new Image();
      img.onerror = () => reject('Erro ao processar imagem.');
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // Resize proportionally if larger than maxDimension
        if (width > maxDimension || height > maxDimension) {
          if (width >= height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const isPng = (file.type === 'image/png') || /\.png$/i.test(file.name || '');
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        if (!isPng) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
        }
        ctx.drawImage(img, 0, 0, width, height);

        try {
          let dataUrl;
          if (isPng) {
            dataUrl = canvas.toDataURL('image/png');
            // If PNG is over 450KB, convert to compressed JPEG to preserve browser storage quota
            if (dataUrl.length > 450 * 1024) {
              const jCanvas = document.createElement('canvas');
              jCanvas.width = width;
              jCanvas.height = height;
              const jCtx = jCanvas.getContext('2d');
              jCtx.fillStyle = '#ffffff';
              jCtx.fillRect(0, 0, width, height);
              jCtx.drawImage(img, 0, 0, width, height);
              dataUrl = jCanvas.toDataURL('image/jpeg', quality);
            }
          } else {
            dataUrl = canvas.toDataURL('image/jpeg', quality);
          }
          resolve(dataUrl);
        } catch (err) {
          // Fallback to original DataURL if canvas export fails
          resolve(e.target.result);
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ─── SEED DATA ───────────────────────────────────────────── */

(function seedIfEmpty() {
  const menu = getMenu();
  if (Object.keys(menu).length > 0) return;

  const seed = {
    entradas: [
      { id:generateId(), name:'Onion Rings', price:'18,90',
        description:'Anéis de cebola empanados e fritos na hora, crocantes por fora e macios por dentro. Servidos com molho especial da casa.',
        videoUrl:'', imageUrl:'', tags:['Veggie','Crocante'] },
      { id:generateId(), name:'Batata Frita Premium', price:'16,90',
        description:'Batata palito crocante temperada com ervas finas e alho tostado. Acompanha molho cheddar artesanal.',
        videoUrl:'', imageUrl:'', tags:['Clássico'] },
    ],
    hamburgueres: [
      { id:generateId(), name:'Gamaa Smash', price:'34,90',
        description:'Dois smash burgers 120g de blend especial, queijo cheddar americano, maionese defumada, picles artesanal e cebola caramelizada no brioche amanteigado.',
        videoUrl:'', imageUrl:'', tags:['Destaque','Smash'] },
      { id:generateId(), name:'Duplo Bacon', price:'42,90',
        description:'Dois smash burgers 120g, bacon crocante, queijo cheddar duplo, alface americana, tomate e molho barbecue defumado.',
        videoUrl:'', imageUrl:'', tags:['Bacon','Duplo'] },
    ],
    combos: [
      { id:generateId(), name:'Combo Gamaa', price:'49,90',
        description:'Gamaa Smash + Batata Frita Premium + Bebida à escolha (350ml). O combo mais pedido da casa!',
        videoUrl:'', imageUrl:'', tags:['Mais Pedido','Completo'] },
    ],
    sobremesas: [
      { id:generateId(), name:'Brownie com Sorvete', price:'22,90',
        description:'Brownie de chocolate meio amargo quentinho com bola de sorvete de creme e calda de chocolate belga.',
        videoUrl:'', imageUrl:'', tags:['Chocolate','Quente'] },
    ],
    bebidas: [
      { id:generateId(), name:'Refrigerante Lata', price:'8,90',
        description:'Coca-Cola, Guaraná Antarctica, Sprite ou Fanta Laranja. Lata 350ml gelada.',
        videoUrl:'', imageUrl:'', tags:['350ml'] },
      { id:generateId(), name:'Milk-shake Artesanal', price:'24,90',
        description:'Milk-shake cremoso nos sabores: Chocolate, Morango, Baunilha ou Ninho. 400ml.',
        videoUrl:'', imageUrl:'', tags:['Cremoso','400ml'] },
    ],
  };

  saveMenu(seed);
})();


// Sincroniza dados remotos após definir os dados padrão.
window.addEventListener('load', () => { initializeRemotePersistence(); });
