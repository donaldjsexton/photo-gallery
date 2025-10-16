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
	if (id) wrap.dataset.id = id;
	wrap.dataset.name = name;
	wrap.dataset.url = url;
	wrap.innerHTML = `
	<img class="thumb" src="${url}" loading="lazy" alt="${escapeHtml(name)}">
	<div class="bar">
	<div class="name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
	<button class="del" aria-label="Remove image">Delete</button>
	</div>
	`;
	wrap.querySelector('.del').addEventListener('click', () => removeItem(wrap));
	grid.appendChild(wrap);
}

function removeItem(cardEl) {
	const name = cardEl.dataset.name;
	const url = cardEl.dataset.url || '';
	const isBlob = url.startsWith('blob:');

	const doDelete = isBlob
	? Promise.resolve()
	: fetch(`/api/images?name=${encodeURIComponent(name)}`, { method: 'DELETE' });

	doDelete.then(async (res) => {
		if (!isBlob && res && !res.ok) {
			alert('Delete failed');
			return;
		}
		if (isBlob) {
			try {URL.revokeObjectURL(url); } catch {}
			const i = items.findIndex(x => x.name === name);
			if (i !== -1) items.splice(i,1);
		}
		cardEl.remove();
	}).catch(()=> alert('Delete failed'));
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

window.addEventListener('DOMContentLoaded', load);

