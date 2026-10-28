const fallback='http://localhost:3000/';
const field=document.getElementById('url'),status=document.getElementById('status');
chrome.storage.local.get('libraryUrl').then(s=>field.value=s.libraryUrl||fallback);
function valid(){const url=new URL(field.value);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw Error('请填写 HTTPS 网址或本机预览地址');return url.href}
document.getElementById('save').onclick=async()=>{try{await chrome.storage.local.set({libraryUrl:valid()});status.textContent='已保存'}catch(e){status.textContent=e.message}};
document.getElementById('open').onclick=async()=>{try{await chrome.tabs.create({url:valid()})}catch(e){status.textContent=e.message}};
