'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const film = new URLSearchParams(location.search).has('film');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.body.classList.toggle('film', film);
  const keys = ['jev', 'opus'];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => '$' + Number(value || 0).toFixed(6);
  const fmt = value => Number(value).toFixed(2);
  const decision = result => typeof result.decision === 'object' ? result.decision.action || result.decision.decision : result.decision;
  const query = row => typeof row.input === 'object' ? row.input.search_term || row.input.searchTerm || row.input.query || row.label : row.input;
  let data, origin, duration, selected = 0, current = 0, playing = false, lastTick = 0, cells = [], summaryStart, raceSeconds;
  const canvas = $('flow'), ctx = canvas.getContext('2d');
  function flow(t, inRace) {
    if (reduced && !film) return;
    const w = innerWidth, h = innerHeight;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.clearRect(0, 0, w, h);
    // Parallel paths echo the two independent request queues; frame time drives every position.
    for (let lane = 0; lane < 2; lane++) {
      ctx.strokeStyle = lane ? '#a06d46' : '#669c54';
      ctx.lineWidth = film ? 1.7 : 1;
      for (let j = 0; j < 5; j++) {
        const y = ((j * 271 + t * (inRace ? 27 : 18) + lane * 97) % (h + 260)) - 130;
        ctx.globalAlpha = .11 + j * .025;
        ctx.beginPath(); ctx.moveTo(-100,y);ctx.bezierCurveTo(w*.25,y-170,w*.65,y+220,w+100,y-20);ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
  function resultHTML(row, key, at) {
    const r = row[key], done = at >= r.end - origin;
    if (!done) return `<article class="result-card ${key}"><h3>${escape(data.models[key].label)}</h3><span class="status">${at >= r.start - origin ? 'Processing this input' : 'Queued in the recorded run'}</span><p>Seek past ${fmt(r.end - origin)} s to reveal the recorded result.</p></article>`;
    return `<article class="result-card ${key}"><h3>${escape(data.models[key].label)}</h3><span class="status done ${escape(String(decision(r)).toLowerCase())}">${escape(decision(r))}</span><p>${escape(r.reason || r.rationale || '')}</p><p>${fmt(r.latency)} s response latency · ${money(r.costUSD)} ${escape(r.cost_basis || data.models[key].cost_basis)}</p><p class="receipt">Started +${fmt(r.start-origin)} s · completed +${fmt(r.end-origin)} s<br>${Number(r.inputTokens)} input / ${Number(r.outputTokens)} output tokens<br>Receipt: ${escape(r.requestId || 'not supplied')}</p></article>`;
  }
  function inspect(index) {
    selected = index;
    const row = data.rows[index];
    $('selected-title').textContent = query(row);
    $('selected-position').textContent = `Input ${index+1} of ${data.rows.length} · Authored reference: ${row.expectedDecision}`;
    const input = typeof row.input === 'object' ? row.input : {input: row.input};
    $('selected-input').innerHTML = '<dl>' + Object.entries(input).map(([key,value]) => `<dt>${escape(key.replace(/_/g,' '))}</dt><dd>${escape(typeof value === 'object' ? JSON.stringify(value) : value)}</dd>`).join('') + '</dl>';
    document.querySelectorAll('.term-row').forEach((el,i) => {el.classList.toggle('selected', i === index);el.querySelector('button').setAttribute('aria-pressed', String(i === index));});
    $('selected-results').innerHTML = keys.map(key => resultHTML(row,key,current)).join('');
  }
  function laneState(key, at) {
    const m = data.models[key], absolute = origin + at;
    const finished = data.rows.filter(row => row[key].end <= absolute);
    return {completed:finished.length, costUSD:finished.reduce((sum,row)=>sum+Number(row[key].costUSD || 0),0), clock: Math.max(0,Math.min(absolute,m.end)-m.start), decisions:data.rows.map(row=>absolute >= row[key].end ? decision(row[key]) : null)};
  }
  function render(at, visualTime = at) {
    current = Math.max(0, Math.min(duration, at));
    const state = {ready:true,playing,film,time:current,duration,selected,models:{},raceSeconds,summaryStart};
    keys.forEach(key => {
      const lane = laneState(key,current); state.models[key] = lane;
      $(key+'-clock').innerHTML = `${fmt(lane.clock)}<span>s</span>`;
      $(key+'-count').textContent = `${lane.completed} / ${data.rows.length}`;
      $(key+'-cost').textContent = money(lane.costUSD);
      $(key+'-progress').style.transform = `scaleX(${lane.completed/data.rows.length})`;
    });
    data.rows.forEach((row,i)=>keys.forEach(key=>{
      const r=row[key], cell=cells[i][key], elapsed=current+origin-r.start;
      const done = current+origin >= r.end, active = elapsed >=0 && !done;
      const text=done ? decision(r) : active ? 'PROCESSING' : 'QUEUED';
      cell.status.textContent = text;
      cell.status.className = 'status '+(done ? 'done '+String(text).toLowerCase() : active ? 'running' : '');
      cell.arrival.textContent = done ? fmt(r.latency)+' s' : active ? fmt(elapsed)+' s' : '—';
      cell.line.style.transform = `scaleX(${done ? 1 : active ? Math.min(.96,elapsed/Math.max(.001,r.latency)) : 0})`;
      cell.root.dataset.state = done ? 'done' : active ? 'running' : 'queued';
    }));
    $('timeline').value = current;
    $('time').textContent = `${fmt(current)} / ${fmt(duration)} s`;
    $('selected-results').innerHTML = keys.map(key=>resultHTML(data.rows[selected],key,current)).join('');
    $('play').innerHTML = playing ? 'Pause replay <span aria-hidden="true">Ⅱ</span>' : 'Play replay <span aria-hidden="true">▶</span>';
    $('completion-note').textContent = current >= duration ? 'All 20 responses received. Inspect any search term.' : 'Each result appears at its recorded completion time.';
    flow(visualTime,current < duration);
    window.demoState=state;
  }
  function filmFrame(frame,fps=30) {
    const t=frame/fps;
    const at=Math.min(duration,Math.max(0,t-2)*duration/raceSeconds);
    render(at,t);
    const summary=t>=summaryStart;
    $('race').hidden=summary;
    $('film-summary').hidden=!summary;
    document.querySelector('.hero').classList.toggle('summary-hero',summary);
    if (summary) {
      const j=data.models.jev,o=data.models.opus;
      $('eyebrow').textContent='THE RESULT / ONE RECORDED RUN';
      $('headline').innerHTML=j.elapsed < o.elapsed ? 'The same queue. <em>Less waiting.</em>' : 'Ten decisions. <em>Measured, openly.</em>';
      $('subhead').textContent=`JEV ${fmt(j.elapsed)} s · Opus 5 ${fmt(o.elapsed)} s · API cost ${money(j.costUSD)} vs ${money(o.costUSD)}`;
      const phase=t-summaryStart;
      const index=Math.min(9,Math.floor(phase/Math.max(2,(40-summaryStart)/3))*3);
      const row=data.rows[index];
      $('film-detail').innerHTML=`<p class="eyebrow">DECISION ${String(index+1).padStart(2,'0')} / 10 · ACTUAL MODEL OUTPUT</p><div class="focus-query">“${escape(query(row))}”</div><div class="focus-routes">${keys.map(key=>`<div class="focus-route ${key}">${escape(data.models[key].label)} <span aria-hidden="true">→</span><strong>${escape(decision(row[key]))}</strong><small>${fmt(row[key].latency)} s · ${money(row[key].costUSD)}</small></div>`).join('')}</div>`;
      // A steady push keeps the inspected input in focus throughout the reading beat.
      $('film-detail').style.transform=`translateX(${Math.sin(phase*.2)*8}px) scale(${1+phase*.0012})`;
    } else {
      $('eyebrow').textContent=t<2?'YOUR SEARCH TERMS ARE A DECISION QUEUE.':'TEN IDENTICAL INPUTS / RESPONSES ARRIVE AT RECORDED TIMES';
      $('headline').innerHTML=t<2?`10 decisions. <em>${fmt(data.models.jev.elapsed)} seconds.</em>`: at >= data.models.jev.end-origin && at < data.models.opus.end-origin ? `JEV finished. <em>Opus: ${laneState('opus',at).completed} of 10.</em>`:'Keep. Exclude. Review. <em>Watch both.</em>';
      $('subhead').textContent='Synthetic Waco junk-removal searches. EXCLUDE = candidate for human approval.';
    }
    window.demoState.filmTime=t;
    window.demoState.phase=summary?'summary':'race';
    return window.demoState;
  }
  function tick(now) {
    if (playing) {
      const next=current+(now-lastTick)/1000;
      if(next>=duration)playing=false;
      render(next);
    }
    lastTick=now;
    if(!film)requestAnimationFrame(tick);
  }
  async function init() {
    const response=await fetch('benchmark.json');
    if(!response.ok)throw Error('Recorded evidence is unavailable ('+response.status+').');
    data=await response.json();
    if(data.status!=='complete'||data.rows?.length!==10)throw Error('The recorded run is incomplete. Results are not ready for replay.');
    for(const row of data.rows)for(const key of keys)if(!Number.isFinite(row[key]?.start)||!Number.isFinite(row[key]?.end)||!['KEEP','EXCLUDE','REVIEW'].includes(decision(row[key])))throw Error('Recorded evidence failed validation.');
    origin=Math.min(...keys.map(key=>data.models[key].start));
    duration=Math.max(...keys.map(key=>data.models[key].end))-origin;
    raceSeconds=Math.min(32,duration); summaryStart=2+raceSeconds;
    $('timeline').max=duration;
    $('rows').innerHTML=data.rows.map((row,i)=>`<div class="term-row" data-row="${i}"><button class="term-button" type="button" aria-pressed="false" aria-label="Inspect input ${i+1}: ${escape(query(row))}"><span class="row-id">${String(i+1).padStart(2,'0')}</span><span class="query">${escape(query(row))}</span></button>${keys.map(key=>`<div class="decision-cell ${key}" data-key="${key}"><span class="status">QUEUED</span><span class="arrival"></span><i class="workline"></i></div>`).join('')}</div>`).join('');
    document.querySelectorAll('.term-row').forEach((row,i)=>{
      row.querySelector('button').addEventListener('click',()=>{inspect(i);render(current)});
      cells[i]={};keys.forEach(key=>{const root=row.querySelector(`[data-key="${key}"]`);cells[i][key]={root,status:root.querySelector('.status'),arrival:root.querySelector('.arrival'),line:root.querySelector('.workline')};});
    });
    const j=data.models.jev,o=data.models.opus;
    const matches=key=>data.rows.filter(row=>decision(row[key])===row.expectedDecision).length;
    const ratio=j.elapsed ? o.elapsed/j.elapsed : 0;
    const costRatio=j.costUSD ? o.costUSD/j.costUSD : 0;
    $('summary-metrics').innerHTML=`<div class="summary-metric"><strong>${ratio>=1 ? ratio.toFixed(1)+'×' : fmt(j.elapsed)+' s'}</strong><span>${ratio>=1?'JEV queue speedup':'JEV queue time'}</span></div><div class="summary-metric"><strong>${costRatio>=1?costRatio.toFixed(1)+'×':money(j.costUSD)}</strong><span>${costRatio>=1?'Opus / JEV API cost':'JEV API cost'}</span></div><div class="summary-metric"><strong>${matches('jev')} / 10</strong><span>Both models match authored labels</span></div>`;
    const basis=[...new Set(keys.flatMap(key=>[].concat(data.models[key].cost_basis)))].join(' / ');
    const temperature=typeof data.conditions.temperature==='object' ? keys.map(key=>`${data.models[key].label}: ${data.conditions.temperature[key]}`).join(' · ') : String(data.conditions.temperature);
    $('cost-note').textContent=`API cost: ${basis}. Billed responses only.`;
    $('replay-label').textContent=film&&duration>32?`Recorded replay · ${(duration/32).toFixed(2)}× BOTH lanes`:'Recorded replay · 1× speed';
    $('method-details').innerHTML=`<dl><dt>Model identifiers</dt><dd>JEV: ${escape(j.model)}<br>Opus 5: ${escape(o.model)}</dd><dt>Conditions</dt><dd>${escape(data.conditions.provider)} · temperature ${escape(temperature)} · concurrency ${escape(data.conditions.concurrencyPerModel)} per model<br>Queues started ${data.conditions.queuesStartedConcurrently?'concurrently':'sequentially'} · Opus reasoning ${escape(data.conditions.opusReasoning)}<br>${escape(data.conditions.limitations || '')}</dd><dt>Business brief</dt><dd>${escape(data.dataset.business)}<br>${escape(data.dataset.instructions)}<br>${escape(data.dataset.workflow || '')}</dd><dt>Cost and timing</dt><dd>${escape(basis)}. Clock: queue wall time. Row timing: individual request latency. Network and provider latency included. Costs tick only at completed responses.</dd><dt>Reference labels</dt><dd>Authored for these synthetic examples, not independent evaluation. JEV ${matches('jev')}/10 · Opus 5 ${matches('opus')}/10 matches.</dd><dt>Evidence identity</dt><dd>Dataset ${escape(data.dataset.id)}<br>SHA-256 ${escape(data.dataset.sha256)}</dd></dl>`;
    $('loading').hidden=true;$('experience').hidden=false;
    inspect(0);render(0);
    $('play').addEventListener('click',()=>{if(current>=duration)current=0;playing=!playing;lastTick=performance.now();render(current)});
    $('restart').addEventListener('click',()=>{playing=false;render(0);inspect(0)});
    $('timeline').addEventListener('input',event=>{playing=false;render(Number(event.target.value))});
    window.renderFrame=filmFrame;
    if(film)filmFrame(0);else requestAnimationFrame(tick);
  }
  init().catch(error=>{$('loading').textContent=error.message;window.demoState={ready:false,error:error.message};console.error(error.message)});
})();
