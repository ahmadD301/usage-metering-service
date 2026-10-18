export const pageHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Document processing demo</title>
<style>
  :root { color-scheme: light dark; --bg: #ffffff; --fg: #1b1f24; --muted: #59636e; --line: #d0d7de; --ok: #1a7f37; --bad: #cf222e; --accent: #0969da; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0d1117; --fg: #e6edf3; --muted: #9198a1; --line: #30363d; --ok: #3fb950; --bad: #f85149; --accent: #4493f8; }
  }
  body { margin: 0; padding: 24px; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; max-width: 980px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 28px 0 8px; }
  p.lead { color: var(--muted); margin: 0 0 16px; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 8px 0; }
  button { font: inherit; padding: 6px 14px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--fg); cursor: pointer; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #ffffff; }
  button:disabled { opacity: 0.5; cursor: default; }
  select, input { font: inherit; padding: 5px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--fg); }
  input[type=number] { width: 90px; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line); }
  th { color: var(--muted); font-weight: 600; font-size: 13px; }
  .step { border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; margin: 8px 0; }
  .step .title { font-weight: 600; }
  .step .expected { color: var(--muted); font-size: 13px; }
  .badge { display: inline-block; min-width: 18px; font-weight: 700; margin-right: 6px; }
  .pass { color: var(--ok); }
  .fail { color: var(--bad); }
  #result { min-height: 24px; margin-top: 8px; }
</style>
</head>
<body>
<h1>Document processing demo</h1>
<p class="lead">A simulated app that charges one unit per page through the usage metering service. The processing code never changes. Only the plans do.</p>

<div class="row">
  <button id="scenario" class="primary">Run guided scenario</button>
  <button id="newAccount">New demo account</button>
</div>

<h2>Try it yourself</h2>
<div class="row">
  <select id="user"><option value="alice">alice</option><option value="bob">bob</option></select>
  <input id="pages" type="number" min="1" value="10" aria-label="Pages">
  <button id="process">Process document</button>
</div>
<div class="row">
  <select id="plan"><option value="Basic">Basic</option><option value="Premium">Premium</option></select>
  <button id="switch">Switch the selected user's plan</button>
</div>
<div id="result" role="status"></div>

<h2>Remaining allowances</h2>
<div id="state">Loading...</div>

<h2>Scenario steps</h2>
<div id="steps"><span class="expected">Run the guided scenario to see each step.</span></div>

<script>
var stateBox = document.getElementById('state');
var stepsBox = document.getElementById('steps');
var resultLine = document.getElementById('result');

function cell(row, text) {
  var td = document.createElement('td');
  td.textContent = text;
  row.appendChild(td);
}

function renderState(state) {
  stateBox.replaceChildren();
  if (!state) { stateBox.textContent = 'No demo account yet. Create one first.'; return; }
  var table = document.createElement('table');
  var head = document.createElement('tr');
  ['', 'Plan', 'Used this month', 'Left this month', 'Max per request'].forEach(function (h) {
    var th = document.createElement('th'); th.textContent = h; head.appendChild(th);
  });
  table.appendChild(head);
  function add(name, plan, used, left, max) {
    var tr = document.createElement('tr');
    cell(tr, name); cell(tr, plan); cell(tr, String(used));
    cell(tr, left === null ? 'unlimited' : String(left));
    cell(tr, max === null ? '-' : String(max));
    table.appendChild(tr);
  }
  add('Account (shared)', state.accountPlan, state.accountConsumed, state.accountRemaining, null);
  state.users.forEach(function (u) { add(u.name, u.planName, u.consumedThisMonth, u.monthlyRemaining, u.maxPerRequest); });
  stateBox.appendChild(table);
}

function renderSteps(steps) {
  stepsBox.replaceChildren();
  steps.forEach(function (s) {
    var box = document.createElement('div'); box.className = 'step';
    var title = document.createElement('div'); title.className = 'title';
    var badge = document.createElement('span');
    badge.className = 'badge ' + (s.passed ? 'pass' : 'fail');
    badge.textContent = s.passed ? 'OK' : 'X';
    title.appendChild(badge);
    title.appendChild(document.createTextNode(s.title));
    var expected = document.createElement('div'); expected.className = 'expected'; expected.textContent = 'Expected: ' + s.expected;
    var summary = document.createElement('div'); summary.textContent = s.summary;
    box.appendChild(title); box.appendChild(expected); box.appendChild(summary);
    stepsBox.appendChild(box);
  });
}

async function call(path, method, body) {
  var response = await fetch(path, {
    method: method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  return response.json();
}

async function act(path, body, after) {
  document.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
  resultLine.textContent = 'Working...';
  try {
    var data = await call(path, 'POST', body);
    if (data.error) { resultLine.textContent = 'Error: ' + data.error; } else { resultLine.textContent = ''; after(data); }
  } catch (e) {
    resultLine.textContent = 'Error: ' + e.message;
  } finally {
    document.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
  }
}

document.getElementById('scenario').addEventListener('click', function () {
  act('/api/scenario', null, function (data) {
    renderSteps(data.steps); renderState(data.state);
    resultLine.textContent = data.allPassed ? 'All steps behaved as expected.' : 'Some steps did not match the expectation.';
  });
});
document.getElementById('newAccount').addEventListener('click', function () {
  act('/api/new-account', null, function (data) { stepsBox.replaceChildren(); renderState(data.state); resultLine.textContent = 'New demo account ready.'; });
});
document.getElementById('process').addEventListener('click', function () {
  act('/api/process', { user: document.getElementById('user').value, pages: Number(document.getElementById('pages').value) }, function (data) {
    resultLine.textContent = data.summary; renderState(data.state);
  });
});
document.getElementById('switch').addEventListener('click', function () {
  act('/api/switch', { user: document.getElementById('user').value, plan: document.getElementById('plan').value }, function (data) {
    resultLine.textContent = 'Plan switched. Try processing again.'; renderState(data.state);
  });
});

call('/api/state', 'GET').then(function (data) { renderState(data.state); });
</script>
</body>
</html>
`;
