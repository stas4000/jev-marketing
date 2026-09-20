'use strict';

const workflows = {
  ad_tags: {title: 'Ad library tags', short: 'Ad tags', subtitle: 'Find creative patterns', kicker: 'Imported creative records', description: 'Group supplied ads by hook, format, and offer. Keep the observed days running beside the creative.', boundary: 'Only the records you supply are analyzed. Days observed running do not establish spend, conversions, or profitability.'},
  survival: {title: '60-day longevity', short: 'Longevity', subtitle: 'Count with the right denominator', kicker: 'Dates and observed status', description: 'Compare formats using ads old enough to have reached 60 days. Keep young, censored observations visible.', boundary: 'This is descriptive longevity in your sample, not a survival model or a probability that an ad will succeed.'},
  briefs: {title: 'Creative brief scoring', short: 'Brief scoring', subtitle: 'Review before production', kicker: 'Hook, brand fit, and readiness', description: 'Check a supplied creative brief against your brand. Inspect the hook, fit, and readiness before making the asset.', boundary: 'Scores support editorial review. They do not predict campaign performance. Low-confidence judgments need a person.'},
  search_terms: {title: 'Search-term review', short: 'Search terms', subtitle: 'Surface negative candidates', kicker: 'Imported search-term reports', description: 'Classify supplied search terms against your business. Export negative keyword candidates for a careful review.', boundary: 'Candidates are not automatically applied. Review match types and conversion evidence before changing an account.'},
  fatigue: {title: 'Creative fatigue signals', short: 'Creative fatigue', subtitle: 'Compare frequency and CTR', kicker: 'Paired observation windows', description: 'Compare frequency and click-through rate together. Flag fatigue signals only when the supplied data is sufficient.', boundary: 'A signal is not proof of creative fatigue. Auction changes, audiences, seasonality, and measurement can also shift CTR.'},
  landing_match: {title: 'Ad-to-page alignment', short: 'Landing match', subtitle: 'Check the promise against the page', kicker: 'Ad promise and landing-page text', description: 'Compare the promise in your ad with the text on its landing page. Surface mismatches before sending more traffic.', boundary: 'Text alignment does not establish truth, page usability, conversion quality, or legal compliance. No page is crawled.'},
  leads: {title: 'Lead fit scoring', short: 'Lead fit', subtitle: 'Use an explicit customer profile', kicker: 'Business facts and your ideal customer', description: 'Score submitted business facts against an explicit ideal-customer profile. Keep the criteria visible for review.', boundary: 'Fit is not conversion probability. Do not use sensitive demographics or inferred personal traits to rank people.'}
};
const paths = {
  ad_tags: '<path d="M3 4h8l10 10-7 7L3 10z"/><circle cx="7.5" cy="8" r="1"/>',
  survival: '<path d="M4 4v16h17M7 15l4-5 4 2 5-8"/><path d="M17 4h3v3"/>',
  briefs: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h3m2 2 2 2 4-5"/>',
  search_terms: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5M8 10.5h5"/>',
  fatigue: '<path d="M2 12h4l3-8 5 16 3-8h5"/>',
  landing_match: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 14l3 3 6-5"/>',
  leads: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 9l2 2 4-4"/>'
};
const icon = key => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[key]}</svg>`;
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const label = value => String(value).replace(/_/g, ' ').replace(/\bctr\b/gi, 'CTR');
const format = value => value === null ? 'Not available' : typeof value === 'object' ? JSON.stringify(value) : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
let examples;
let selected = 'ad_tags';
let view = 'results';

for (const element of document.querySelectorAll('[data-icon]')) element.innerHTML = icon(element.dataset.icon);
document.querySelector('#workflow-picker').innerHTML = Object.entries(workflows).map(([key, item]) => `<button type="button" class="workflow-button" data-workflow="${key}" aria-pressed="${key === selected}"><span class="picker-icon">${icon(key)}</span><span><strong>${item.short}</strong><small>${item.subtitle}</small></span></button>`).join('');

function formatMetric(key, value) {
  if (typeof value !== 'number') return format(value);
  if (['prior_ctr', 'current_ctr', 'ctr_relative_decline', 'frequency_relative_increase'].includes(key)) return `${(value * 100).toFixed(1)}%`;
  if (['prior_frequency', 'current_frequency'].includes(key)) return value.toFixed(2);
  return format(value);
}
function evidenceHtml(value) {
  if (Array.isArray(value)) return `<ul>${value.map(item => `<li>${escapeHtml(format(item))}</li>`).join('')}</ul>`;
  if (value && typeof value === 'object') return `<ul>${Object.entries(value).map(([key, item]) => {
    if (key === 'answers') return `<li>Rubric: ${Object.entries(item).map(([name, answer]) => `${escapeHtml(label(name))}: ${escapeHtml(answer.choice ?? answer.score)}`).join(' · ')}</li>`;
    if (key === 'input_fields') return `<li>Supplied fields: ${item.map(field => escapeHtml(label(field))).join(', ')}</li>`;
    if (['prior', 'current'].includes(key) && item && typeof item === 'object') return `<li>${escapeHtml(label(key))}: ${escapeHtml(item.start_date)} to ${escapeHtml(item.end_date)}; ${escapeHtml(Number(item.impressions).toLocaleString('en-US'))} impressions, ${escapeHtml(Number(item.clicks).toLocaleString('en-US'))} clicks, ${escapeHtml(Number(item.reach).toLocaleString('en-US'))} reach.</li>`;
    if (key === 'source_id') return `<li>Source record: ${escapeHtml(item)}</li>`;
    return `<li>${escapeHtml(label(key))}: ${escapeHtml(format(item))}</li>`;
  }).join('')}</ul>`;
  return escapeHtml(format(value));
}
function renderResults(output) {
  const rows = output.rows || [];
  const inputCount = examples[selected].input.records.length;
  const cards = rows.map((row, index) => {
    const decision = typeof row.decision === 'object' ? 'Inspect decision' : label(row.decision ?? 'Result');
    const fields = Object.entries(row).filter(([key]) => !['id', 'decision', 'evidence', 'confidence'].includes(key)).flatMap(([key, value]) => ['tags', 'scores'].includes(key) ? Object.entries(value) : [[key, value]]);
    if (row.confidence !== null && row.confidence !== undefined) fields.push(['demo confidence', `${row.confidence} (illustrative)`]);
    if (row.decision && typeof row.decision === 'object') fields.unshift(...Object.entries(row.decision));
    return `<article class="result-card"><div class="result-heading"><span class="record-id">${escapeHtml(row.id ?? `record ${index + 1}`)}</span><span class="decision">${escapeHtml(decision)}</span></div><div class="result-fields">${fields.map(([key, value]) => `<dl class="field"><dt>${escapeHtml(label(key))}</dt><dd>${escapeHtml(formatMetric(key, value))}</dd></dl>`).join('')}</div>${row.evidence !== undefined ? `<div class="evidence"><b>Evidence</b>${evidenceHtml(row.evidence)}</div>` : ''}</article>`;
  }).join('');
  return `<div class="result-meta"><span><strong>${inputCount} supplied records</strong> · ${rows.length} result rows</span><span>Saved engine output</span></div>${cards}${output.summary ? `<div class="result-summary"><h4>Sample summary</h4>${Array.isArray(output.summary) ? output.summary.map(item => `<div class="summary-row">${evidenceHtml(item)}</div>`).join('') : evidenceHtml(output.summary)}</div>` : ''}`;
}
function render() {
  const item = workflows[selected];
  document.querySelector('#workflow-title').textContent = item.title;
  document.querySelector('#workflow-kicker').textContent = item.kicker;
  document.querySelector('#workflow-description').textContent = item.description;
  document.querySelector('#workflow-boundary').textContent = item.boundary;
  document.querySelector('#workspace-icon').innerHTML = icon(selected);
  document.querySelectorAll('.workflow-button').forEach(button => button.setAttribute('aria-pressed', button.dataset.workflow === selected));
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', button.dataset.view === view));
  if (!examples) return;
  const example = examples[selected];
  const content = document.querySelector('#example-content');
  if (view === 'results') content.innerHTML = renderResults(example.output);
  else content.innerHTML = `<pre class="json-view" tabindex="0" aria-label="${view === 'input' ? 'Input' : 'Output'} JSON">${escapeHtml(JSON.stringify(example[view], null, 2))}</pre>`;
}
for (const button of document.querySelectorAll('[data-workflow]')) {
  button.addEventListener('click', () => {
    selected = button.dataset.workflow;
    render();
  });
}
for (const button of document.querySelectorAll('[data-view]')) {
  button.addEventListener('click', () => { view = button.dataset.view; render(); });
}
document.querySelector('#download-json').addEventListener('click', () => {
  if (!examples) return;
  const content = view === 'input' ? examples[selected].input : examples[selected].output;
  const blob = new Blob([JSON.stringify(content, null, 2) + '\n'], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${selected}-${view === 'input' ? 'input' : 'demo-output'}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.querySelector('#copy-command').addEventListener('click', async () => {
  const command = document.querySelector('#install-command');
  const status = document.querySelector('#copy-status');
  try {
    await navigator.clipboard.writeText(command.textContent);
    status.textContent = 'Commands copied. Paste them into your terminal.';
  } catch {
    const range = document.createRange();
    range.selectNodeContents(command);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    status.textContent = 'Copy unavailable. Commands selected; use your device’s Copy action.';
  }
});
render();
fetch('data.json').then(response => {
  if (!response.ok) throw new Error('Examples unavailable');
  return response.json();
}).then(data => {
  examples = data.workflows;
  for (const key of Object.keys(workflows)) {
    if (!examples[key]?.input?.records || !examples[key]?.output?.rows) throw new Error('Incomplete examples');
  }
  render();
}).catch(() => {
  document.querySelector('#example-content').innerHTML = '<p>The saved examples could not be loaded. <a href="data.json">Open the dataset</a> or <a href="https://github.com/stas4000/jev-marketing/tree/main/examples">read the fixtures on GitHub</a>.</p>';
  document.querySelector('#download-json').disabled = true;
});
