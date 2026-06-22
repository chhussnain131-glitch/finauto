/**
 * Ledger v3 — transactions, month filter, monthly comparison, bill reminders.
 */

const CURRENCY = 'Rs';
const API_BASE  = '/api';
const PALETTE   = ['#C9A567','#2DD4BF','#FB7185','#60A5FA','#A78BFA',
                   '#F59E0B','#34D399','#F472B6','#94A3B8','#38BDF8'];
const MONTHS    = ['January','February','March','April','May','June',
                   'July','August','September','October','November','December'];

let transactions = [], activeType = 'Expense', activeFilter = '';
let ieChart = null, catChart = null, compChart = null;

// ── center-text plugin ────────────────────────────────────────────────────
Chart.register({
  id:'centerText',
  afterDraw(chart){
    const o=chart.config.options.plugins?.centerText;
    if(!o?.text) return;
    const {ctx,chartArea:a}=chart;
    const x=(a.left+a.right)/2, y=(a.top+a.bottom)/2;
    ctx.save();
    ctx.font='600 11px Inter,sans-serif'; ctx.fillStyle='#7C8696';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(o.label||'',x,y-10);
    ctx.font='700 16px Outfit,sans-serif'; ctx.fillStyle=o.color||'#fff';
    ctx.fillText(o.text,x,y+10); ctx.restore();
  }
});

// ── helpers ───────────────────────────────────────────────────────────────
const fmt  = v=>`${CURRENCY} ${(+v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const fmtD = s=>{ const d=new Date(`${s}T00:00:00`); return isNaN(d)?s:d.toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'}); };
const esc  = s=>{ const d=document.createElement('div'); d.textContent=s??''; return d.innerHTML; };
const today= ()=>new Date().toISOString().slice(0,10);
const flbl = ()=>{ if(!activeFilter) return 'All time'; const[y,m]=activeFilter.split('-'); return `${MONTHS[+m-1]} ${y}`; };
const fpar = ()=>{ if(!activeFilter) return ''; const[y,m]=activeFilter.split('-'); return `?month=${+m}&year=${y}`; };

// ── API ───────────────────────────────────────────────────────────────────
async function GET(path){ const r=await fetch(API_BASE+path); const j=await r.json(); if(!r.ok||!j.success) throw new Error(j.error||'Failed'); return j.data; }
async function SEND(path,method,body){ const r=await fetch(API_BASE+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const j=await r.json(); if(!r.ok||!j.success) throw new Error(j.error||'Failed'); return j.data; }
async function DEL(path){ const r=await fetch(API_BASE+path,{method:'DELETE'}); const j=await r.json(); if(!r.ok||!j.success) throw new Error(j.error||'Failed'); }

// ── load all dashboard data ───────────────────────────────────────────────
async function loadDashboard(){
  const p=fpar();
  try{
    const [summary,txs,comp,rems]=await Promise.all([
      GET(`/summary${p}`), GET(`/transactions${p}`),
      GET('/monthly-comparison'), GET('/reminders')
    ]);
    transactions=txs;
    renderSummary(summary);
    renderDonutCharts(summary);
    renderComparisonChart(comp);
    renderReminders(rems);
    renderTable(txs);
    updateLabels();
  }catch(e){ console.error(e); alert('Could not load data. Check Supabase .env and reload.'); }
}

// ── month dropdown ────────────────────────────────────────────────────────
async function loadMonths(){
  try{
    const ms=await GET('/months');
    const sel=document.getElementById('monthFilter');
    while(sel.options.length>1) sel.remove(1);
    ms.forEach(ym=>{ const[y,m]=ym.split('-'); const o=document.createElement('option'); o.value=ym; o.textContent=`${MONTHS[+m-1]} ${y}`; sel.appendChild(o); });
    sel.value=activeFilter;
  }catch(_){}
}

function updateLabels(){
  const l=flbl();
  document.getElementById('filterLabelIncome').textContent=l;
  document.getElementById('filterLabelExpense').textContent=l;
  document.getElementById('chartLabel1').textContent=activeFilter?`Filtered: ${l}`:'All recorded transactions';
  document.getElementById('chartLabel2').textContent=activeFilter?`Filtered: ${l}`:'Expenses grouped by category';
}

document.getElementById('monthFilter').addEventListener('change',async function(){
  activeFilter=this.value; await loadDashboard(); await loadMonths();
});

// ── summary cards ─────────────────────────────────────────────────────────
function renderSummary(s){
  document.getElementById('totalIncome').textContent=fmt(s.total_income);
  document.getElementById('totalExpense').textContent=fmt(s.total_expense);
  const el=document.getElementById('totalSurplus');
  el.textContent=fmt(s.surplus);
  const pos=s.surplus>=0;
  el.className=`font-display text-2xl md:text-[28px] font-semibold mt-2 tabular-nums truncate ${pos?'text-income':'text-expense'}`;
  const rate=s.total_income>0?Math.max(0,Math.min(100,(s.surplus/s.total_income)*100)):0;
  document.getElementById('surplusNote').textContent=s.total_income>0?`${rate.toFixed(0)}% of income saved`:'Add income to see savings rate';
  document.getElementById('surplusPct').textContent=`${rate.toFixed(0)}%`;
  const c=pos?'#2DD4BF':'#FB7185';
  document.getElementById('surplusRing').style.background=`conic-gradient(${c} ${rate*3.6}deg,#1B212C 0deg)`;
}

// ── donut charts ──────────────────────────────────────────────────────────
function renderDonutCharts(s){
  if(ieChart) ieChart.destroy();
  ieChart=new Chart(document.getElementById('incomeExpenseChart'),{
    type:'doughnut',
    data:{labels:['Income','Expense'],datasets:[{data:[s.total_income,s.total_expense],backgroundColor:['#2DD4BF','#FB7185'],borderColor:'#12161F',borderWidth:3,hoverOffset:6}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'72%',
      plugins:{legend:{position:'bottom',labels:{color:'#A8B0BE',boxWidth:10,padding:16,font:{size:11}}},
               tooltip:{callbacks:{label:c=>` ${c.label}: ${fmt(c.raw)}`}},
               centerText:{label:'Surplus',text:fmt(s.surplus),color:s.surplus>=0?'#2DD4BF':'#FB7185'}}}
  });

  const cats=Object.keys(s.category_breakdown||{}), vals=Object.values(s.category_breakdown||{});
  const empty=document.getElementById('categoryEmpty');
  if(!cats.length){
    if(catChart){catChart.destroy();catChart=null;}
    empty.classList.remove('hidden');
    document.getElementById('categoryChart').classList.add('invisible');
    return;
  }
  empty.classList.add('hidden');
  document.getElementById('categoryChart').classList.remove('invisible');
  if(catChart) catChart.destroy();
  catChart=new Chart(document.getElementById('categoryChart'),{
    type:'doughnut',
    data:{labels:cats,datasets:[{data:vals,backgroundColor:cats.map((_,i)=>PALETTE[i%PALETTE.length]),borderColor:'#12161F',borderWidth:3,hoverOffset:6}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'60%',
      plugins:{legend:{position:'bottom',labels:{color:'#A8B0BE',boxWidth:10,padding:16,font:{size:11}}},
               tooltip:{callbacks:{label:c=>` ${c.label}: ${fmt(c.raw)}`}}}}
  });
}

// ── monthly comparison bar chart ──────────────────────────────────────────
function renderComparisonChart(d){
  if(compChart) compChart.destroy();
  compChart=new Chart(document.getElementById('comparisonChart'),{
    type:'bar',
    data:{
      labels:d.labels,
      datasets:[
        {label:'Income', data:d.incomes, backgroundColor:'rgba(45,212,191,0.8)', borderRadius:6, borderSkipped:false},
        {label:'Expense',data:d.expenses,backgroundColor:'rgba(251,113,133,0.8)',borderRadius:6, borderSkipped:false},
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{legend:{position:'bottom',labels:{color:'#A8B0BE',boxWidth:10,padding:16,font:{size:11}}},
               tooltip:{callbacks:{label:c=>` ${c.dataset.label}: ${fmt(c.raw)}`}}},
      scales:{
        x:{grid:{color:'#232938'},ticks:{color:'#7C8696',font:{size:11}}},
        y:{grid:{color:'#232938'},ticks:{color:'#7C8696',font:{size:11},callback:v=>`${CURRENCY} ${(v/1000).toFixed(0)}k`}}
      }
    }
  });
}

// ── bill reminders ────────────────────────────────────────────────────────
function renderReminders(rems){
  const body=document.getElementById('remindersBody');
  const empty=document.getElementById('remindersEmpty');
  body.innerHTML='';
  if(!rems.length){ body.appendChild(empty); empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  rems.forEach(r=>{
    const paid=r.paid_this_month;
    const overdue=r.overdue;
    const pill=document.createElement('div');
    pill.className=`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-sm font-medium transition-all
      ${paid?'border-income/30 bg-income/5 text-income':''}
      ${overdue&&!paid?'border-expense/40 bg-expense/5 text-expense':''}
      ${!paid&&!overdue?'border-border bg-surface2 text-muted':''}`;

    const icon=paid?'✓':overdue?'!':'○';
    const status=paid?'Paid':'overdue?`Overdue (due ${r.due_date_this_month.slice(8)}th)`:`Due ${r.due_date_this_month.slice(8)}th`';

    // build cleanly
    const iconSpan=document.createElement('span');
    iconSpan.className='w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold '+(paid?'bg-income/20 text-income':overdue?'bg-expense/20 text-expense':'bg-border text-muted');
    iconSpan.textContent=paid?'✓':overdue?'!':'○';

    const info=document.createElement('div');
    info.className='flex flex-col';
    info.innerHTML=`<span class="text-white text-xs font-semibold">${esc(r.name)}</span>
      <span class="text-[10px] ${paid?'text-income':overdue?'text-expense':'text-muted'}">
        ${paid?'Paid this month':overdue?`Overdue · due ${r.due_date_this_month.slice(8)}th`:`Due on ${r.due_date_this_month.slice(8)}th`}
        ${r.amount?` · ${fmt(r.amount)}`:''}
      </span>`;

    const del=document.createElement('button');
    del.className='ml-auto text-muted hover:text-expense text-lg leading-none pl-1';
    del.textContent='×';
    del.addEventListener('click',()=>deleteReminder(r.id));

    pill.appendChild(iconSpan);
    pill.appendChild(info);
    pill.appendChild(del);
    body.appendChild(pill);
  });
}

async function deleteReminder(id){
  if(!confirm('Remove this reminder?')) return;
  try{ await DEL(`/reminders/${id}`); await loadDashboard(); }
  catch(e){ alert(e.message); }
}

// ── reminder modal ────────────────────────────────────────────────────────
const remOverlay=document.getElementById('reminderOverlay');
const remSheet=document.getElementById('reminderSheet');

function openReminderModal(){ remOverlay.classList.remove('hidden'); remOverlay.classList.add('flex'); document.body.style.overflow='hidden'; requestAnimationFrame(()=>remSheet.classList.remove('translate-y-full')); }
function closeReminderModal(){ remSheet.classList.add('translate-y-full'); document.body.style.overflow=''; setTimeout(()=>{ remOverlay.classList.add('hidden'); remOverlay.classList.remove('flex'); },250); }

document.getElementById('openReminderBtn').addEventListener('click',openReminderModal);
document.getElementById('closeReminderBtn').addEventListener('click',closeReminderModal);
remOverlay.addEventListener('click',e=>{ if(e.target===remOverlay) closeReminderModal(); });

document.getElementById('reminderForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const errEl=document.getElementById('reminderError');
  errEl.classList.add('hidden');
  const payload={
    name:    document.getElementById('remNameInput').value,
    category:document.getElementById('remCategoryInput').value,
    due_day: document.getElementById('remDayInput').value,
    amount:  document.getElementById('remAmountInput').value||null,
  };
  try{ await SEND('/reminders','POST',payload); closeReminderModal(); document.getElementById('reminderForm').reset(); await loadDashboard(); }
  catch(e){ errEl.textContent=e.message; errEl.classList.remove('hidden'); }
});

// ── transaction table ─────────────────────────────────────────────────────
function renderTable(rows){
  const tbody=document.getElementById('transactionsBody');
  const empty=document.getElementById('emptyState');
  const cnt=document.getElementById('txCount');
  tbody.innerHTML='';
  cnt.textContent=`${rows.length} transaction${rows.length===1?'':'s'}`;
  if(!rows.length){ empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  rows.forEach(tx=>{
    const inc=tx.type==='Income';
    const tr=document.createElement('tr');
    tr.className='hover:bg-surface2/60 transition-colors';
    tr.innerHTML=`
      <td class="px-5 py-3 whitespace-nowrap text-muted">${fmtD(tx.date)}</td>
      <td class="px-5 py-3 whitespace-nowrap"><span class="inline-flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full ${inc?'bg-income':'bg-expense'}"></span>${esc(tx.category)}</span></td>
      <td class="px-5 py-3 text-muted hidden sm:table-cell max-w-[220px] truncate">${esc(tx.note||'—')}</td>
      <td class="px-5 py-3 text-right font-medium tabular-nums whitespace-nowrap ${inc?'text-income':'text-expense'}">${inc?'+':'−'} ${fmt(tx.amount)}</td>
      <td class="px-5 py-3 text-right whitespace-nowrap">
        <button class="edit-btn text-muted hover:text-white px-1.5" data-id="${tx.id}">Edit</button>
        <button class="delete-btn text-muted hover:text-expense px-1.5" data-id="${tx.id}">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('.edit-btn').forEach(b=>b.addEventListener('click',()=>openEditModal(b.dataset.id)));
  tbody.querySelectorAll('.delete-btn').forEach(b=>b.addEventListener('click',()=>handleDelete(b.dataset.id)));
}

// ── transaction modal ─────────────────────────────────────────────────────
const overlay=document.getElementById('modalOverlay');
const sheet=document.getElementById('modalSheet');
const form=document.getElementById('transactionForm');

function openModal(){ overlay.classList.remove('hidden'); overlay.classList.add('flex'); document.body.style.overflow='hidden'; requestAnimationFrame(()=>sheet.classList.remove('translate-y-full')); }
function closeModal(){ sheet.classList.add('translate-y-full'); document.body.style.overflow=''; setTimeout(()=>{ overlay.classList.add('hidden'); overlay.classList.remove('flex'); },250); }

function setType(t){ activeType=t; document.querySelectorAll('.type-btn').forEach(b=>{ const s=b.dataset.type===t; b.classList.toggle('bg-income',s&&t==='Income'); b.classList.toggle('bg-expense',s&&t==='Expense'); b.classList.toggle('text-canvas',s); b.classList.toggle('border-transparent',s); b.classList.toggle('bg-surface2',!s); b.classList.toggle('text-muted',!s); b.classList.toggle('border-border',!s); }); }

function openAddModal(){ form.reset(); document.getElementById('transactionId').value=''; document.getElementById('modalTitle').textContent='Add Transaction'; document.getElementById('deleteBtn').classList.add('hidden'); document.getElementById('dateInput').value=today(); document.getElementById('formError').classList.add('hidden'); setType('Expense'); openModal(); }

function openEditModal(id){ const tx=transactions.find(t=>String(t.id)===String(id)); if(!tx) return; document.getElementById('transactionId').value=tx.id; document.getElementById('modalTitle').textContent='Edit Transaction'; document.getElementById('deleteBtn').classList.remove('hidden'); document.getElementById('amountInput').value=tx.amount; document.getElementById('categoryInput').value=tx.category; document.getElementById('dateInput').value=tx.date; document.getElementById('noteInput').value=tx.note||''; document.getElementById('formError').classList.add('hidden'); setType(tx.type); openModal(); }

document.getElementById('openAddBtn').addEventListener('click',openAddModal);
document.getElementById('fabAddBtn').addEventListener('click',openAddModal);
document.getElementById('closeModalBtn').addEventListener('click',closeModal);
overlay.addEventListener('click',e=>{ if(e.target===overlay) closeModal(); });
document.querySelectorAll('.type-btn').forEach(b=>b.addEventListener('click',()=>setType(b.dataset.type)));

form.addEventListener('submit',async e=>{
  e.preventDefault();
  const errEl=document.getElementById('formError'); errEl.classList.add('hidden');
  const id=document.getElementById('transactionId').value;
  const payload={ amount:document.getElementById('amountInput').value, type:activeType, category:document.getElementById('categoryInput').value, date:document.getElementById('dateInput').value, note:document.getElementById('noteInput').value };
  try{ id?await SEND(`/transactions/${id}`,'PUT',payload):await SEND('/transactions','POST',payload); closeModal(); await loadDashboard(); await loadMonths(); }
  catch(e){ errEl.textContent=e.message; errEl.classList.remove('hidden'); }
});

document.getElementById('deleteBtn').addEventListener('click',()=>{ const id=document.getElementById('transactionId').value; if(id) handleDelete(id); });

async function handleDelete(id){ if(!confirm('Delete this transaction?')) return; try{ await DEL(`/transactions/${id}`); closeModal(); await loadDashboard(); await loadMonths(); }catch(e){ alert(e.message); } }

// ── init ──────────────────────────────────────────────────────────────────
document.getElementById('todayDate').textContent=new Date().toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'});
(async()=>{ await loadMonths(); await loadDashboard(); })();
