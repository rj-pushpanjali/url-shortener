const test = require('node:test');
const assert = require('node:assert/strict');
const metrics = require('../src/utils/metrics');
const { routeLabel } = require('../src/middleware/metrics.middleware');

test('counter renders HELP, TYPE and labelled series', () => {
  const c = metrics.counter('test_counter_total', 'A test counter.');
  c.inc({ route: '/a', status: 200 });
  c.inc({ route: '/a', status: 200 }, 2);
  c.inc({ route: '/b', status: 404 });
  const text = metrics.render();
  assert.match(text, /# HELP test_counter_total A test counter\./);
  assert.match(text, /# TYPE test_counter_total counter/);
  assert.match(text, /test_counter_total\{route="\/a",status="200"\} 3/);
  assert.match(text, /test_counter_total\{route="\/b",status="404"\} 1/);
});

test('histogram buckets are cumulative and end with +Inf, _sum and _count', () => {
  const h = metrics.histogram('test_latency_seconds', 'A test histogram.', [0.1, 1]);
  h.observe({ m: 'GET' }, 0.05);
  h.observe({ m: 'GET' }, 0.5);
  h.observe({ m: 'GET' }, 5);
  const text = metrics.render();
  assert.match(text, /test_latency_seconds_bucket\{m="GET",le="0\.1"\} 1/);
  assert.match(text, /test_latency_seconds_bucket\{m="GET",le="1"\} 2/);
  assert.match(text, /test_latency_seconds_bucket\{m="GET",le="\+Inf"\} 3/);
  assert.match(text, /test_latency_seconds_count\{m="GET"\} 3/);
  assert.match(text, /test_latency_seconds_sum\{m="GET"\} 5\.55/);
});

test('label values are escaped', () => {
  const c = metrics.counter('test_escape_total', 'Escaping.');
  c.inc({ v: 'a"b\\c\nd' });
  assert.match(metrics.render(), /test_escape_total\{v="a\\"b\\\\c\\nd"\} 1/);
});

test('an unused counter still renders a zero sample', () => {
  metrics.counter('test_unused_total', 'Never incremented.');
  assert.match(metrics.render(), /^test_unused_total 0$/m);
});

test('process gauges are present and output ends with a newline', () => {
  const text = metrics.render();
  assert.match(text, /^process_uptime_seconds [\d.]+$/m);
  assert.match(text, /^process_resident_memory_bytes \d+$/m);
  assert.ok(text.endsWith('\n'));
});

test('routeLabel uses the route pattern, never the raw URL', () => {
  assert.equal(routeLabel({ baseUrl: '/api/urls', route: { path: '/:id' } }), '/api/urls/:id');
  assert.equal(routeLabel({ baseUrl: '', route: { path: '/:code' } }), '/:code');
  assert.equal(routeLabel({ baseUrl: '' }), 'unmatched');
});
