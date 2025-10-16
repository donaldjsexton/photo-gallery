const grid = document.getElementById('grid');
const form = document.getElementById('uform');
const input = document.getElementById('file');
const drop = document.getElementById('drop');
const status = document.getElementById('status');

const items = [];

function uid() {
	return Math.random().toString(36).slice(2, 10);
}

function addFiles(files){
	if (!files || !files.length) return;
	status.textContent = `Adding ${files.length}...`;
	for (const f of files) {
		if (!f.type.startsWith('image/')) continue;
		const url = URL.createObjectURL(f);
		const id = uid();
		items.push({ id, name: f.name, url, file: f });
		renderItem({ id, name: f.name, url });
	}
	status.textContent = `Added ${files.length} image${files.length>1?'s':''}`;
}

function renderItem({ id, name, url }) {
	const wrap = document.createElement('div');
	wrap.className = 'item';
	wrap.dataset.id = id;
	wrap.innerHTML = `
	<img class="thumb" src="${url}" loading="lazy" alt="${escapeHtml(name)}">
	<div class="bar">
	<div class="name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
	<button class="del" aria-label="Remove image">Delete</button>
	</div>
	`;
	wrap.querySelector('.del').addEventListener('click', () => removeItem(id));
	grid.appendChild(wrap);
}

function removeItem(id) {
	const i = items.findIndex(x => x.id === id);
	if (i === -1) return;
	URL.revokeObjectURL(items[i].url);
	items.splice(i, 1);
	const node = grid.querySelector(`.item[data-id="${id}"]`);
	if (node) node.remove();
}

function escapeHtml(s) {
	return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

	async function uploadOne(f){
	const buf = await f.arrayBuffer();
	const url = `/api/upload?name=${encodeURIComponent(f.name)}`;
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type':'application/octet-stream' },
		body: buf
	});
	if (!res.ok) throw new Error('upload failed');
	}

	form.addEventListener('submit', async (e) => {
	e.preventDefault();
		  const files = Array.from(input.files || []);
		  if (!files.length) return;

		  await Promise.all(files.map(uploadOne));
	
	await load();
	form.reset();
	});

	async function load(){
		const res = await fetch('/api/images');
		const data = await res.json();
		grid.innerHTML = '';
		for (const it of data.items) {
			renderItem({ id: it.id || it.name, name: it.name, url: it.full });
		}
	}
	

;['dragenter','dragover'].forEach(evt => {
	drop.addEventListener(evt, e=> {
		e.preventDefault(); e.stopPropagation();
		drop.classList.add('drag');
	});
});
;['dragleave','drop'].forEach(evt => {
	drop.addEventListener(evt, e => {
		e.preventDefault(); e.stopPropagation();
		drop.classList.remove('drag');
	});
});
drop.addEventListener('drop', (e) => {
	addFiles(e.dataTransfer.files);
});

window.addEventListener('paste', (e) => {
	const files = Array.from(e.clipboardData?.files || []).filter(f => f.type.startsWith('image/'));
	if (files.length) addFiles(files);
});

fetch('/api/images').then(r=>r.json()).then(d=>console.log('images:', d));
window.addEventListener('DOMContentLoaded', load);

