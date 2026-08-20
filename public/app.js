const API_BASE = '';
let token = localStorage.getItem('rk_token');
let candidaturas = [];
let sortField = 'fecha_postulacion';
let sortAsc = false;
let editingId = null;
let isLoggingIn = false;

async function doLogin() {
  if (isLoggingIn) return;
  isLoggingIn = true;
  const pwd = document.getElementById('loginPassword').value;
  const err = document.getElementById('loginError');
  const btn = document.querySelector('#loginScreen button');
  btn.disabled = true;
  btn.textContent = 'Entrando...';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd })
    });
    const data = await res.json();
    if (res.ok && data.token) {
      token = data.token;
      localStorage.setItem('rk_token', token);
      showApp();
    } else {
      err.style.display = 'block';
      err.textContent = data.error || 'Error de autenticacion';
    }
  } catch (e) {
    err.style.display = 'block';
    err.textContent = 'No se pudo conectar con el servidor';
  } finally {
    isLoggingIn = false;
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}

function doLogout() {
  localStorage.removeItem('rk_token');
  token = null;
  location.reload();
}

async function verifyToken() {
  if (!token) return false;
  try {
    const res = await fetch('/api/verify', { headers: { 'Authorization': 'Bearer ' + token } });
    return res.ok;
  } catch (e) { return false; }
}

async function init() {
  if (token && await verifyToken()) showApp();
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  refreshData();
}

async function apiGet(url) {
  const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
  if (res.status === 401 || res.status === 403) { doLogout(); throw new Error('Sesion expirada'); }
  if (!res.ok) throw new Error((await res.json()).error || 'Error');
  return res.json();
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401 || res.status === 403) { doLogout(); throw new Error('Sesion expirada'); }
  if (!res.ok) throw new Error((await res.json()).error || 'Error');
  return res.json();
}

async function apiPut(url, body) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401 || res.status === 403) { doLogout(); throw new Error('Sesion expirada'); }
  if (!res.ok) throw new Error((await res.json()).error || 'Error');
  return res.json();
}

async function apiDelete(url) {
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + token }
  });
  if (res.status === 401 || res.status === 403) { doLogout(); throw new Error('Sesion expirada'); }
  if (!res.ok) throw new Error((await res.json()).error || 'Error');
  return res.json();
}

async function refreshData() {
  try {
    candidaturas = await apiGet('/api/candidaturas');
    updateStats();
    renderTable();
    document.getElementById('subtitle').textContent = candidaturas.length + ' candidaturas registradas';
  } catch (e) {
    toast('Error cargando datos: ' + e.message, 'error');
  }
}

function updateStats() {
  const counts = {
    total: candidaturas.length,
    proceso: candidaturas.filter(c => c.estado === 'En proceso').length,
    entrevista: candidaturas.filter(c => c.estado && c.estado.includes('Entrevista')).length,
    oferta: candidaturas.filter(c => c.estado === 'Oferta recibida').length,
    rechazo: candidaturas.filter(c => c.estado === 'Rechazado' || c.estado === 'Descartado').length,
    // NUEVO: candidaturas con al menos 1 email recibido
    emails: candidaturas.filter(c => Array.isArray(c.emails_recibidos) && c.emails_recibidos.length > 0).length
  };
  document.getElementById('statTotal').textContent = counts.total;
  document.getElementById('statProceso').textContent = counts.proceso;
  document.getElementById('statEntrevista').textContent = counts.entrevista;
  document.getElementById('statOferta').textContent = counts.oferta;
  document.getElementById('statRechazo').textContent = counts.rechazo;
  document.getElementById('statEmails').textContent = counts.emails;
}

function renderTable() {
  const search = document.getElementById('searchInput').value.toLowerCase();
  const fEstado = document.getElementById('filterEstado').value;
  const fPortal = document.getElementById('filterPortal').value;

  let filtered = candidaturas.filter(c => {
    const matchesSearch = !search ||
      (c.empresa && c.empresa.toLowerCase().includes(search)) ||
      (c.puesto && c.puesto.toLowerCase().includes(search)) ||
      (c.ubicacion && c.ubicacion.toLowerCase().includes(search)) ||
      (c.notas && c.notas.toLowerCase().includes(search));
    const matchesEstado = !fEstado || c.estado === fEstado;
    const matchesPortal = !fPortal || c.portal === fPortal;
    return matchesSearch && matchesEstado && matchesPortal;
  });

  filtered.sort((a, b) => {
    let va = a[sortField] || '';
    let vb = b[sortField] || '';
    if (sortField === 'fecha_postulacion') {
      va = new Date(va).getTime(); vb = new Date(vb).getTime();
    }
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return sortAsc ? -1 : 1;
    if (va > vb) return sortAsc ? 1 : -1;
    return 0;
  });

  document.querySelectorAll('.sort-icon').forEach(el => el.textContent = '-');
  const activeIcon = document.getElementById('sort-' + sortField);
  if (activeIcon) activeIcon.textContent = sortAsc ? '^' : 'v';

  const tbody = document.getElementById('tableBody');
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><div>No hay candidaturas que coincidan con los filtros</div></td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(c => {
    const badgeClass = 'badge-' + (c.estado || 'pendiente').toLowerCase().replace(/\s+/g, '');
    const alertasNorm = normalizeAlertas(c.alertas);
    const alertasHtml = alertasNorm.length
      ? alertasNorm.map(a =>
        '<span class="alerta-tag' + (a.tipo === 'danger' ? '' : ' alerta-tag-warning') + '">' +
        (a.tipo === 'danger' ? '⛔' : '⚠') + ' ' + escapeHtml(a.texto) + '</span>').join('')
      : '<span style="color:var(--text-muted);font-size:0.8rem;">-</span>';

    // NUEVO: badge de emails recibidos en la celda empresa/puesto
    const emailCount = Array.isArray(c.emails_recibidos) ? c.emails_recibidos.length : 0;
    const emailBadge = emailCount > 0
      ? '<div class="email-badge">📧 ' + emailCount + ' email' + (emailCount > 1 ? 's' : '') + '</div>'
      : '';

    return '<tr>' +
      '<td><div class="clickable-company" onclick="openDetailModal(\'' + c.id + '\')" title="Ver detalle">' +
      '<div class="empresa-cell">' + escapeHtml(c.empresa || '') + '</div>' +
      '<div class="puesto-cell">' + escapeHtml(c.puesto || '') + '</div>' +
      '<div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">' + escapeHtml(c.portal || '') + '</div>' +
      emailBadge +
      '</div></td>' +
      '<td><span class="badge ' + badgeClass + '">' + escapeHtml(c.estado || 'Pendiente') + '</span></td>' +
      '<td class="salario-cell">' + escapeHtml(c.salario || 'No especificado') + '</td>' +
      '<td>' + escapeHtml(c.ubicacion || '-') + '</td>' +
      '<td class="fecha-cell">' + formatDate(c.fecha_postulacion) + '</td>' +
      '<td><div class="alertas-list">' + alertasHtml + '</div></td>' +
      '<td class="actions-cell">' +
      '<button onclick="editCandidatura(\'' + c.id + '\')" title="Editar">Editar</button>' +
      '<button onclick="deleteCandidatura(\'' + c.id + '\')" title="Eliminar">Eliminar</button>' +
      '</td></tr>';
  }).join('');
}

function sortBy(field) {
  if (sortField === field) sortAsc = !sortAsc;
  else { sortField = field; sortAsc = true; }
  renderTable();
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(d) {
  if (!d) return '-';
  const date = new Date(d);
  if (isNaN(date)) return d;
  return date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

function normalizeAlertas(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(a => {
    if (typeof a === 'string') return { texto: a, tipo: 'warning' };
    if (a && typeof a === 'object') return { texto: a.texto || '', tipo: a.tipo === 'danger' ? 'danger' : 'warning' };
    return { texto: '', tipo: 'warning' };
  }).filter(a => a.texto);
}

function linesToArray(text) {
  return text.split('\n').map(s => s.trim()).filter(Boolean);
}

function openAddModal() {
  editingId = null;
  document.getElementById('modalTitle').textContent = 'Nueva Candidatura';
  document.getElementById('analyzeSection').style.display = 'block';
  clearForm();
  document.getElementById('modalOverlay').classList.add('active');
  document.getElementById('rawText').value = '';
  document.getElementById('rawText').focus();
}

function openEditModal(c) {
  editingId = c.id;
  document.getElementById('modalTitle').textContent = 'Editar Candidatura';
  document.getElementById('analyzeSection').style.display = 'none';
  document.getElementById('fEmpresa').value = c.empresa || '';
  document.getElementById('fPuesto').value = c.puesto || '';
  document.getElementById('fPortal').value = c.portal || 'LinkedIn';
  document.getElementById('fSalario').value = c.salario || '';
  document.getElementById('fContrato').value = c.contrato || '';
  document.getElementById('fHorario').value = c.horario || '';
  document.getElementById('fUbicacion').value = c.ubicacion || '';
  document.getElementById('fEstado').value = c.estado || 'Pendiente';
  document.getElementById('fFecha').value = c.fecha_postulacion || '';
  document.getElementById('fUrl').value = c.url_oferta || '';
  document.getElementById('fNotas').value = c.notas || '';
  const alertasNorm = normalizeAlertas(c.alertas);
  document.getElementById('fAlertas').value = alertasNorm.filter(a => a.tipo !== 'danger').map(a => a.texto).join('\n');
  document.getElementById('fAlertasGraves').value = alertasNorm.filter(a => a.tipo === 'danger').map(a => a.texto).join('\n');
  document.getElementById('fMatch').value = c.match || '';
  document.getElementById('fCv').value = c.cv || '';
  document.getElementById('fCarta').value = c.carta || '';
  document.getElementById('fEmpresaDesc').value = c.empresa_desc || '';
  document.getElementById('fResponsabilidades').value = (c.responsabilidades || []).join('\n');
  document.getElementById('fArgumentos').value = (c.argumentos || []).join('\n');
  document.getElementById('modalOverlay').classList.add('active');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
}

function clearForm() {
  document.getElementById('fEmpresa').value = '';
  document.getElementById('fPuesto').value = '';
  document.getElementById('fPortal').value = 'LinkedIn';
  document.getElementById('fSalario').value = '';
  document.getElementById('fContrato').value = '';
  document.getElementById('fHorario').value = '';
  document.getElementById('fUbicacion').value = '';
  document.getElementById('fEstado').value = 'Pendiente';
  document.getElementById('fFecha').value = new Date().toISOString().split('T')[0];
  document.getElementById('fUrl').value = '';
  document.getElementById('fNotas').value = '';
  document.getElementById('fAlertas').value = '';
  document.getElementById('fAlertasGraves').value = '';
  document.getElementById('fMatch').value = '';
  document.getElementById('fCv').value = '';
  document.getElementById('fCarta').value = '';
  document.getElementById('fEmpresaDesc').value = '';
  document.getElementById('fResponsabilidades').value = '';
  document.getElementById('fArgumentos').value = '';
}

function fillManual() {
  document.getElementById('analyzeSection').style.display = 'none';
  document.getElementById('fEmpresa').focus();
}

let isAnalyzing = false;

async function analyzeText() {
  if (isAnalyzing) return;
  const text = document.getElementById('rawText').value.trim();
  if (!text || text.length < 30) {
    toast('El texto es demasiado corto. Pega la oferta completa.', 'error');
    return;
  }
  const btn = document.getElementById('btnAnalyze');
  const original = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span> Analizando...';
  btn.disabled = true;
  try {
    const data = await apiPost('/api/analizar', { texto: text });
    document.getElementById('fEmpresa').value = data.empresa || '';
    document.getElementById('fPuesto').value = data.puesto || '';
    document.getElementById('fPortal').value = data.portal || 'LinkedIn';
    document.getElementById('fSalario').value = data.salario || '';
    document.getElementById('fContrato').value = data.contrato || '';
    document.getElementById('fHorario').value = data.horario || '';
    document.getElementById('fUbicacion').value = data.ubicacion || '';
    document.getElementById('fNotas').value = data.notas || '';
    document.getElementById('fAlertas').value = normalizeAlertas(data.alertas).map(a => a.texto).join('\n');
    document.getElementById('fUrl').value = data.url_oferta || '';
    document.getElementById('fEmpresaDesc').value = data.empresa_desc || '';
    document.getElementById('fResponsabilidades').value = (data.responsabilidades || []).join('\n');
    document.getElementById('analyzeSection').style.display = 'none';
    toast('Datos extraidos por Groq. Revisa y guarda.', 'success');
    document.getElementById('fEmpresa').focus();
  } catch (e) {
    toast('Error analizando: ' + e.message, 'error');
  } finally {
    isAnalyzing = false;
    btn.innerHTML = original;
    btn.disabled = false;
  }
}

let isSaving = false;

async function saveCandidatura() {
  if (isSaving) return;
  isSaving = true;
  const payload = {
    empresa: document.getElementById('fEmpresa').value.trim(),
    puesto: document.getElementById('fPuesto').value.trim(),
    portal: document.getElementById('fPortal').value,
    salario: document.getElementById('fSalario').value.trim(),
    contrato: document.getElementById('fContrato').value.trim(),
    horario: document.getElementById('fHorario').value.trim(),
    ubicacion: document.getElementById('fUbicacion').value.trim(),
    estado: document.getElementById('fEstado').value,
    fecha_postulacion: document.getElementById('fFecha').value,
    url_oferta: document.getElementById('fUrl').value.trim(),
    notas: document.getElementById('fNotas').value.trim(),
    alertas: [
      ...linesToArray(document.getElementById('fAlertas').value).map(texto => ({ texto, tipo: 'warning' })),
      ...linesToArray(document.getElementById('fAlertasGraves').value).map(texto => ({ texto, tipo: 'danger' }))
    ],
    match: document.getElementById('fMatch').value,
    cv: document.getElementById('fCv').value.trim(),
    carta: document.getElementById('fCarta').value.trim(),
    empresa_desc: document.getElementById('fEmpresaDesc').value.trim(),
    responsabilidades: linesToArray(document.getElementById('fResponsabilidades').value),
    argumentos: linesToArray(document.getElementById('fArgumentos').value)
  };
  if (!payload.empresa || !payload.puesto) {
    toast('Empresa y puesto son obligatorios', 'error');
    isSaving = false;
    return;
  }
  try {
    if (editingId) {
      await apiPut('/api/candidaturas/' + editingId, payload);
      toast('Candidatura actualizada', 'success');
    } else {
      await apiPost('/api/candidaturas', payload);
      toast('Candidatura anadida', 'success');
    }
    closeModal();
    refreshData();
  } catch (e) {
    toast('Error guardando: ' + e.message, 'error');
  } finally {
    isSaving = false;
  }
}

function editCandidatura(id) {
  const c = candidaturas.find(x => x.id === id);
  if (c) openEditModal(c);
}

let detailId = null;

function openDetailModal(id) {
  const c = candidaturas.find(x => x.id === id);
  if (!c) return;
  detailId = id;
  renderDetail(c);
  document.getElementById('detailModalOverlay').classList.add('active');
}

function closeDetailModal() {
  document.getElementById('detailModalOverlay').classList.remove('active');
  detailId = null;
}

function editFromDetail() {
  if (!detailId) return;
  const id = detailId;
  closeDetailModal();
  editCandidatura(id);
}

function renderDetail(c) {
  const badgeClass = 'badge-' + (c.estado || 'pendiente').toLowerCase().replace(/\s+/g, '');
  const alertasNorm = normalizeAlertas(c.alertas);
  const alertasHtml = alertasNorm.length
    ? alertasNorm.map(a =>
      '<span class="alerta-tag' + (a.tipo === 'danger' ? '' : ' alerta-tag-warning') + '">' +
      (a.tipo === 'danger' ? '⛔' : '⚠') + ' ' + escapeHtml(a.texto) + '</span>').join('')
    : '<span class="detail-empty">Sin alertas</span>';
  const urlHtml = c.url_oferta
    ? '<a class="detail-link" href="' + escapeHtml(c.url_oferta) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(c.url_oferta) + '</a>'
    : '<span class="detail-empty">Sin URL</span>';
  const notasHtml = c.notas
    ? '<div class="detail-notes">' + escapeHtml(c.notas) + '</div>'
    : '<span class="detail-empty">Sin notas</span>';
  const matchLabel = { alto: 'Match alto', medio: 'Match medio', bajo: 'Match bajo' }[c.match] || '';
  const matchHtml = matchLabel
    ? '<span class="detail-tag match-badge-' + c.match + '">' + matchLabel + '</span>'
    : '';
  const responsabilidades = Array.isArray(c.responsabilidades) ? c.responsabilidades : [];
  const argumentos = Array.isArray(c.argumentos) ? c.argumentos : [];

  const empresaDescHtml = c.empresa_desc
    ? '<div class="detail-section"><div class="detail-label">Sobre la empresa</div><div class="detail-desc">' + escapeHtml(c.empresa_desc) + '</div></div>'
    : '';
  const responsabilidadesHtml = responsabilidades.length
    ? '<div class="detail-section"><div class="detail-label">Responsabilidades del puesto</div><ul class="detail-list">' +
    responsabilidades.map(r => '<li>' + escapeHtml(r) + '</li>').join('') + '</ul></div>'
    : '';
  const argumentosHtml = argumentos.length
    ? '<div class="detail-section"><div class="detail-label">Lo que argumente en la candidatura</div><div class="detail-argumentos-box"><ul class="detail-list">' +
    argumentos.map(a => '<li>' + escapeHtml(a) + '</li>').join('') + '</ul></div></div>'
    : '';

  // NUEVO: sección de emails recibidos en el detalle
  const emails = Array.isArray(c.emails_recibidos) ? c.emails_recibidos : [];
  const emailsHtml = emails.length
    ? '<div class="detail-section"><div class="detail-label">📧 Emails recibidos (' + emails.length + ')</div>' +
    emails.map(e =>
      '<div class="email-item">' +
      '<div class="email-item-subject">' + escapeHtml(e.asunto || '(sin asunto)') + '</div>' +
      '<div class="email-item-meta">De: ' + escapeHtml(e.de || '-') + ' · ' + formatDate(e.fecha) + '</div>' +
      '</div>'
    ).join('') + '</div>'
    : '';

  document.getElementById('detailBody').innerHTML =
    '<div class="detail-company">' + escapeHtml(c.empresa || '') + '</div>' +
    '<div class="detail-puesto">' + escapeHtml(c.puesto || '') + '</div>' +
    '<div class="detail-tags">' +
    '<span class="badge ' + badgeClass + '">' + escapeHtml(c.estado || 'Pendiente') + '</span>' +
    matchHtml +
    '<span class="detail-tag">' + escapeHtml(c.portal || 'No especificado') + '</span>' +
    '</div>' +
    empresaDescHtml +
    responsabilidadesHtml +
    '<div class="detail-section">' +
    '<div class="detail-label">Condiciones</div>' +
    '<div class="detail-grid">' +
    '<div><div class="detail-item-label">Salario</div><div class="detail-item-val">' + escapeHtml(c.salario || 'No especificado') + '</div></div>' +
    '<div><div class="detail-item-label">Contrato</div><div class="detail-item-val">' + escapeHtml(c.contrato || 'No especificado') + '</div></div>' +
    '<div><div class="detail-item-label">Horario</div><div class="detail-item-val">' + escapeHtml(c.horario || 'No especificado') + '</div></div>' +
    '<div><div class="detail-item-label">Ubicacion</div><div class="detail-item-val">' + escapeHtml(c.ubicacion || 'No especificado') + '</div></div>' +
    '<div><div class="detail-item-label">Fecha postulacion</div><div class="detail-item-val">' + formatDate(c.fecha_postulacion) + '</div></div>' +
    '<div><div class="detail-item-label">Ultima actualizacion</div><div class="detail-item-val">' + formatDate(c.fecha_actualizacion) + '</div></div>' +
    '<div><div class="detail-item-label">CV usado</div><div class="detail-item-val">' + escapeHtml(c.cv || 'No especificado') + '</div></div>' +
    '<div><div class="detail-item-label">Carta de presentacion</div><div class="detail-item-val">' + escapeHtml(c.carta || 'No especificado') + '</div></div>' +
    '</div></div>' +
    '<div class="detail-section"><div class="detail-label">URL de la oferta</div>' + urlHtml + '</div>' +
    argumentosHtml +
    emailsHtml +
    '<div class="detail-section"><div class="detail-label">Alertas</div><div class="alertas-list">' + alertasHtml + '</div></div>' +
    '<div class="detail-section"><div class="detail-label">Notas</div>' + notasHtml + '</div>';
}

async function deleteCandidatura(id) {
  const c = candidaturas.find(x => x.id === id);
  if (!c) return;
  if (!confirm('Eliminar candidatura a ' + c.empresa + ' - ' + c.puesto + '?')) return;
  try {
    await apiDelete('/api/candidaturas/' + id);
    toast('Candidatura eliminada', 'info');
    refreshData();
  } catch (e) {
    toast('Error eliminando: ' + e.message, 'error');
  }
}

// NUEVO: escaneo manual de email
let isScanning = false;

async function scanEmails() {
  if (isScanning) return;
  isScanning = true;
  const btn = document.getElementById('btnScanEmail');
  const original = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span> Escaneando...';
  btn.disabled = true;
  try {
    const result = await apiGet('/api/email/scan');
    if (result.error) {
      toast('Error en scan: ' + result.error, 'error');
    } else if (result.skipped) {
      toast('Scan en curso, intenta en unos segundos', 'info');
    } else {
      const n = result.matches ? result.matches.length : 0;
      toast(
        n > 0
          ? '📧 ' + n + ' respuesta' + (n > 1 ? 's' : '') + ' nueva' + (n > 1 ? 's' : '') + ' detectada' + (n > 1 ? 's' : '')
          : 'Sin nuevas respuestas en el email',
        n > 0 ? 'success' : 'info'
      );
      if (n > 0) await refreshData();
    }
  } catch (e) {
    toast('Error escaneando email: ' + e.message, 'error');
  } finally {
    isScanning = false;
    btn.innerHTML = original;
    btn.disabled = false;
  }
}

function toast(message, type) {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = '<span>' + message + '</span>';
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(100%)';
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

init();
