// Exercise page templates against real API responses without a browser host.
const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const source = fs.readFileSync(input.script, 'utf8').split('window.addEventListener("hashchange", render);')[0];
const context = vm.createContext({
  Intl, URLSearchParams, Date, console,
  sessionStorage: {getItem: () => null}, localStorage: {getItem: () => null},
  setInterval: () => {}, location: {hash: '#/family/h_home?tab=pantry'},
  document: {getElementById: () => ({}), querySelectorAll: () => [], documentElement: {dataset: {}}},
  data: input.responses, output: '',
});
vm.runInContext(source, context);
vm.runInContext(`
  api = async (path) => {
    const key = '/api' + path.split('?')[0];
    if (!(key in data)) throw new Error('Unexpected API request: ' + path);
    return data[key];
  };
  shell = (active, html) => { output = html; };
  onFilters = wireMemberButtons = wireTaskButtons = wirePostButtons = wireFixButtons = () => {};
`, context);
(async () => {
  for (const tab of ['members', 'tasks', 'posts', 'lists', 'pantry', 'bills', 'signins', 'issues', 'audit']) {
    await vm.runInContext(`pageFamily('h_home', new URLSearchParams('tab=${tab}'))`, context);
    assert(context.output.includes('Family'));
    if (tab === 'pantry') assert(context.output.includes('Rice'));
    if (tab === 'bills') assert(context.output.includes('Electricity'));
  }
  for (const page of ['pageTasks', 'pagePosts', 'pageAudit']) {
    await vm.runInContext(`${page}(new URLSearchParams('offset=50'))`, context);
    assert(context.output.includes('Previous'));
  }
  const pager = vm.runInContext(`pager(new URLSearchParams('q=rice&overdue=true'), 50)`, context);
  assert(pager.includes('Next') && pager.includes('q=rice') && pager.includes('overdue=true'));
})().catch((error) => { console.error(error); process.exitCode = 1; });
