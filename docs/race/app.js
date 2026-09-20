'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const film = new URLSearchParams(location.search).has('film');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const keys = ['jev', 'opus'], queues = ['keep', 'negative_candidate', 'review'];
  const labels = {keep:'Useful traffic',negative_candidate:'Negative candidate',review:'Needs judgment'};
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => '$' + Number(value).toFixed(6);
  const query = row => typeof row.input === 'string' ? row.input : row.input.search_term || row.input.query || row.label;
  const costLabel = key => data.models[key].cost_basis.some(basis=>basis.includes('estimated')) ? 'estimated API cost' : 'provider API cost';
  const complete = (call, at) => call?.status === 'complete' && call.end <= Math.min(30, at);
  const confidence = value => Number.isFinite(value) ? (value*100).toFixed(1)+'% confidence (not calibrated)' : 'Confidence not returned';
  const ease = x => 1-Math.pow(1-Math.max(0,Math.min(1,x)),3);
  let data, current=0, playing=false, lastTick=0, selected=0, filter='all', productById, ordered, lastListKey='', focusId=null;
  document.body.classList.toggle('film',film);
  function modelState(key,at) {
    const finished=data.rows.filter(row=>complete(row[key],at));
    return {completed:finished.length,costUSD:finished.reduce((sum,row)=>sum+row[key].costUSD,0)};
  }
  function resultHTML(row,key) {
    const call=row[key], shown=call?.status==='complete' && (call.end<=Math.min(current,30) || (current>=30&&call.end>30));
    if(!shown)return `<section class="result-card ${key}"><h4>${escape(data.models[key].label)}</h4><p>${call?.start<=Math.min(current,30)?'Request in flight at this moment.':'Not completed at this replay time.'}</p></section>`;
    const product=key==='jev'?productById.get(row.id):null;
    return `<section class="result-card ${key}"><h4>${escape(data.models[key].label)}${call.end>30?' · outside 30-second window':''}</h4><p class="decision">Actual classification: ${escape(call.decision)}</p>${product?`<p>Product route: ${escape(labels[product.decision])}</p>`:''}<p>${escape(confidence(call.confidence))}</p><p>${money(call.costUSD)} ${escape(call.cost_basis)} · ${call.latency.toFixed(3)} s latency</p><p class="receipt">Started +${call.start.toFixed(3)} s · completed +${call.end.toFixed(3)} s<br>Provider receipt: ${escape(call.requestId)}</p>${product?`<details><summary>Product evidence</summary><pre>${escape(JSON.stringify(product.evidence,null,2))}</pre></details>`:''}</section>`;
  }
  function inspect(index) {
    selected=index; const row=data.rows[index];
    $('selected-position').textContent=`SYNTHETIC INPUT ${index+1} / ${data.rows.length} · ${row.id}`;
    $('selected-title').textContent=query(row);
    $('selected-reference').textContent=`Authored reviewer reference: ${row.expectedDecision}. ${row.reason} This is not a model-generated rationale.`;
    $('selected-input').textContent=JSON.stringify(row.input,null,2);
    $('selected-results').innerHTML=keys.map(key=>resultHTML(row,key)).join('');
    document.querySelectorAll('.record').forEach(el=>el.setAttribute('aria-pressed',String(Number(el.dataset.index)===index)));
  }
  function recordList(at) {
    const signature=keys.map(key=>modelState(key,at).completed).join(':')+':'+filter+':'+(at>=30);
    if(signature===lastListKey)return;lastListKey=signature;
    const rows=data.rows.map((row,index)=>({row,index,product:productById.get(row.id)})).filter(({product})=>filter==='all'||(product&&product.end<=Math.min(at,30)&&product.decision===filter));
    $('records').innerHTML=rows.length?rows.map(({row,index,product})=>`<button class="record" data-index="${index}" aria-pressed="${index===selected}"><strong>${String(index+1).padStart(2,'0')} · ${escape(query(row))}</strong><span>${product&&product.end<=Math.min(at,30)?escape(labels[product.decision]):'Awaiting in-window JEV result'} · ${escape(row.category)}</span></button>`).join(''):'<p class="inspect-note">No completed results in this queue at this time.</p>';
    $('records').querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{inspect(Number(button.dataset.index));render(current)}));
  }
  function renderFeed(at) {
    // Every card maps to a real request. Position interpolates between recorded starts.
    const started=data.rows.filter(row=>row.jev?.start<=Math.min(30,at));
    let index=Math.max(0,started.length-1);
    const here=data.rows[index]?.jev?.start||0, next=data.rows[index+1]?.jev?.start;
    const fraction=Number.isFinite(next)?Math.max(0,Math.min(1,(at-here)/(next-here))):Math.min(.95,Math.max(0,(at-here)/3));
    const cardWidth=film?370:innerWidth<=700?297:350;
    const pose=reduced&&!film?index:index+fraction;
    // The current input stays visible while the completed inputs move left.
    $('input-track').style.transform=`translateX(${-Math.max(0,pose-1)*cardWidth}px)`;
    for(const q of queues) {
      const done=ordered.filter(row=>row.decision===q&&row.end<=Math.min(30,at));
      $('count-'+q).textContent=done.length;
      const container=$('feed-'+q), height=film?65:innerWidth<=700?56:61;
      const shift=done.length&&(reduced&&!film?1:ease((at-done.at(-1).end)/.3));
      container.innerHTML=done.length?done.slice(-4).reverse().map((row,i)=>{
        const arrive=reduced&&!film?1:ease((at-row.end)/.3);
        return `<div class="queue-card" style="transform:translateY(${i*height-(1-shift)*height}px);opacity:${arrive}"><strong>${escape(row.query)}</strong><small>${escape(row.id)} · ${Number.isFinite(row.confidence)?(row.confidence*100).toFixed(1)+'% confidence':'confidence unavailable'}</small></div>`;
      }).join(''):'<p class="queue-empty">Waiting for a recorded result…</p>';
      const p=((at*.9+queues.indexOf(q)*.31)%1), target=216+queues.indexOf(q)*432;
      $('packet-'+q).setAttribute('cx',String(648+(target-648)*ease(Math.min(1,p*1.5))));
      $('packet-'+q).setAttribute('cy',String(48*p));
      $('packet-'+q).style.opacity=at<30?'0.8':'0';
    }
  }
  function renderReference(at) {
    const finished=ordered.filter(row=>row.end<=Math.min(30,at));
    // A four-second reading beat is independent of the faster receipt feed.
    const beat=Math.floor(Math.max(0,at-1)/4)*4+1;
    const eligible=finished.filter(row=>row.end<=beat);
    const disputed=finished.find(row=>row.referenceDecision==='EXCLUDE'&&row.classification==='keep'&&row.decision==='review');
    const focus=disputed&&at>=disputed.end+.1&&at<disputed.end+5?disputed:eligible.at(-1)||finished[0];
    if(!focus){focusId=null;$('focus-label').textContent='BUSINESS CONTEXT';$('focus-query').textContent='A search term is more than a keyword.';$('focus-decision').textContent='Actual results appear as their API responses finish.';$('focus-reason').textContent='A paid junk-removal service in Waco. Buyer intent, job searches and uncertain requests need different next steps.';return}
    focusId=focus.id;
    $('focus-label').textContent='ONE RECORDED RESULT / '+focus.id;
    $('focus-query').textContent='“'+focus.query+'”';
    $('focus-decision').textContent=focus.confidence<data.product.confidenceThreshold?`Low confidence ${(focus.confidence*100).toFixed(0)}% → human review · raw JEV: ${focus.classification}`:`Actual JEV: ${focus.classification.replaceAll('_',' ')} → ${labels[focus.decision]}`;
    $('focus-reason').textContent=focus.referenceReason;
  }
  function render(at) {
    current=Math.max(0,Math.min(36,at));
    const state={ready:true,time:current,duration:36,windowSeconds:30,playing,selected,filter,film,phase:current>=30?'outcome':'work',models:{},counts:{},focusId:null};
    keys.forEach(key=>{
      const lane=modelState(key,current);state.models[key]=lane;
      $(key+'-count').textContent=lane.completed;
      $(key+'-cost').textContent=money(lane.costUSD);
      $(key+'-unit').textContent=lane.completed?`${money(lane.costUSD/lane.completed)} / decision · ${costLabel(key)}`:'Cost / decision appears on completion';
      const active=data.rows.find(row=>row[key]?.start<=Math.min(current,30)&&row[key]?.end>Math.min(current,30));
      $(key+'-active').textContent=current>=30?(data.models[key].inflightCompleted+' request finished after the window'):active?`${(current-active[key].start).toFixed(2)} s processing · ${query(active)}`:'Waiting for next recorded request';
    });
    queues.forEach(q=>{const count=ordered.filter(row=>row.decision===q&&row.end<=Math.min(current,30)).length;state.counts[q]=count;$('out-'+q).textContent=count});
    $('clock').textContent=Math.min(30,current).toFixed(2).padStart(5,'0');
    $('clock-progress').style.transform=`scaleX(${Math.min(1,current/30)})`;
    $('clock-label').textContent=current>=30?'WINDOW CLOSED · RESULTS BELOW':'RECORDED API RUN · TRUE 1×';
    $('timeline').value=current;$('time').textContent=`${current.toFixed(2)} / 36 s`;
    $('play').textContent=playing?'Pause replay Ⅱ':'Play replay ▶';
    $('workflow').hidden=current>=30;$('outcome').hidden=current<30;
    renderFeed(current);renderReference(current);state.focusId=focusId;
    if(current>=30){
      const p=film?ease((current-30)/.7):1;
      $('outcome').style.opacity=String(p);$('outcome').style.transform=`translateY(${(1-p)*16}px) scale(${film?1+(current-30)*.0015:1})`;
    }
    if(!film){recordList(current);$('selected-results').innerHTML=keys.map(key=>resultHTML(data.rows[selected],key)).join('')}
    window.demoState=state;
    return state;
  }
  function tick(now){if(playing){const next=current+(now-lastTick)/1000;if(next>=36)playing=false;render(next)}lastTick=now;if(!film)requestAnimationFrame(tick)}
  async function init() {
    const response=await fetch('benchmark.json');if(!response.ok)throw Error(`Recorded evidence unavailable (${response.status}).`);data=await response.json();
    if(data.status!=='complete'||data.product?.audit?.status!=='pass'||data.schemaVersion!==2||data.windowSeconds!==30||!Array.isArray(data.product?.rows))throw Error('Recorded product evidence is incomplete.');
    for(const row of data.rows)for(const key of keys){const c=row[key];if(c?.status==='complete'&&(!Number.isFinite(c.start)||!Number.isFinite(c.end)||!Number.isFinite(c.costUSD)||!c.requestId))throw Error('A recorded receipt is missing timing, cost or identity.')}
    productById=new Map(data.product.rows.map(row=>[row.id,row]));ordered=[...data.product.rows].sort((a,b)=>a.end-b.end);
    for(const row of ordered)if(!queues.includes(row.decision)||!Number.isFinite(row.end)||!data.rows.some(r=>r.id===row.id&&complete(r.jev,30)))throw Error('Product output does not match a completed JEV receipt.');
    $('input-track').innerHTML=data.rows.map((row,i)=>`<div class="input-card"><small>INPUT ${String(i+1).padStart(3,'0')} · ${escape(row.category)}</small><strong>${escape(query(row))}</strong></div>`).join('');
    const referenceLabels={KEEP:'keep',EXCLUDE:'negative_candidate',REVIEW:'review'};
    const disagreements=ordered.filter(row=>row.classification!==referenceLabels[row.referenceDecision]);
    $('disagreement-note').textContent=`${disagreements.length} labels differ from authored references; ${disagreements.filter(row=>row.decision==='review').length} routed to human review.`;
    const basis=keys.map(key=>`${data.models[key].label}: ${data.models[key].model}`).join(' · ');
    $('method-details').innerHTML=`<dl><dt>Input provenance</dt><dd>${data.rows.length} unique synthetic search terms. Authored labels and business reasons are reviewer references, not independent evaluation or model rationale.</dd><dt>Recorded models</dt><dd>${escape(basis)}</dd><dt>Fair window</dt><dd>Both serial queues receive the same ordered inputs, starting from a shared clock. This is a true 30-second window at 1×. Only successful API responses completed by 30 seconds enter the counters. Requests finishing after the window remain separately inspectable and are excluded from counts and window cost.</dd><dt>Product integration</dt><dd>${escape(data.product.source)}. JEV confidence below ${data.product.confidenceThreshold} routes to review. Confidence is a model output, not a calibrated probability. Negative candidates require human approval; no ad account changes.</dd><dt>API cost</dt><dd>Cost basis: ${keys.map(key=>escape(data.models[key].label+': '+data.models[key].cost_basis.join(', '))).join(' · ')}; totals include completed in-window responses only. Cost per decision divides that total by completed responses. Late-response spend: JEV ${money(data.models.jev.inflightCostUSD||0)}, Opus 5 ${money(data.models.opus.inflightCostUSD||0)}. One run, not a claim of typical latency, accuracy, savings or ROI.</dd><dt>Reproduce and inspect</dt><dd>The downloadable product output is the actual engine result. The benchmark JSON retains inputs, references, API receipt IDs and timing. The page makes no model calls.</dd><dt>Full recorded conditions</dt><dd><pre>${escape(JSON.stringify(data.conditions||{},null,2))}</pre></dd></dl>`;
    $('headline').innerHTML=`${data.models.jev.completed} search terms.<br><em>Clear next actions.</em>`;
    $('loading').hidden=true;$('experience').hidden=false;inspect(0);render(0);
    $('play').addEventListener('click',()=>{if(current>=36)current=0;playing=!playing;lastTick=performance.now();render(current)});
    $('restart').addEventListener('click',()=>{playing=false;filter='all';document.querySelectorAll('[data-filter]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.filter==='all')));render(0);inspect(0)});
    $('timeline').addEventListener('input',event=>{playing=false;render(Number(event.target.value))});
    document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(el=>el.setAttribute('aria-pressed',String(el===button)));render(current)}));
    window.renderFrame=(frame,fps=30)=>render(frame/fps);
    if(!film)requestAnimationFrame(tick);
  }
  init().catch(error=>{$('loading').textContent=error.message;window.demoState={ready:false,error:error.message};console.error(error.message)});
})();
