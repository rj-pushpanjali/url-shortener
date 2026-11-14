// src/utils/metrics.js
//
// A small, dependency-free Prometheus metrics registry (text exposition
// format 0.0.4). Enough for what this project needs: counters, histograms
// and a few process gauges. Scraped from GET /metrics.
//
// Metrics are per PROCESS. Each backend instance exposes its own numbers and
// Prometheus labels them by target (backend1:5000, backend2:5000, ...), so
// you can sum across instances in a query: sum(rate(http_requests_total[1m])).

const counters = [];
const histograms = [];

function escapeLabelValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function labelKey(labels) {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}="${escapeLabelValue(labels[k])}"`)
    .join(',');
}

function counter(name, help) {
  const series = new Map(); // labelKey -> number
  const metric = {
    name,
    help,
    series,
    inc(labels = {}, value = 1) {
      const key = labelKey(labels);
      series.set(key, (series.get(key) || 0) + value);
    },
  };
  counters.push(metric);
  return metric;
}

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

function histogram(name, help, buckets = DEFAULT_BUCKETS) {
  const series = new Map(); // labelKey -> { counts[], sum, count }
  const metric = {
    name,
    help,
    buckets,
    series,
    observe(labels, value) {
      const key = labelKey(labels);
      let s = series.get(key);
      if (!s) {
        s = { counts: new Array(buckets.length).fill(0), sum: 0, count: 0 };
        series.set(key, s);
      }
      for (let i = 0; i < buckets.length; i += 1) {
        if (value <= buckets[i]) s.counts[i] += 1;
      }
      s.sum += value;
      s.count += 1;
    },
  };
  histograms.push(metric);
  return metric;
}

const withLabels = (key, extra) => {
  const all = [key, extra].filter(Boolean).join(',');
  return all ? `{${all}}` : '';
};

function render() {
  const lines = [];

  for (const c of counters) {
    lines.push(`# HELP ${c.name} ${c.help}`, `# TYPE ${c.name} counter`);
    if (c.series.size === 0) lines.push(`${c.name} 0`);
    for (const [key, value] of c.series) lines.push(`${c.name}${withLabels(key)} ${value}`);
  }

  for (const h of histograms) {
    lines.push(`# HELP ${h.name} ${h.help}`, `# TYPE ${h.name} histogram`);
    for (const [key, s] of h.series) {
      h.buckets.forEach((le, i) => lines.push(`${h.name}_bucket${withLabels(key, `le="${le}"`)} ${s.counts[i]}`));
      lines.push(`${h.name}_bucket${withLabels(key, 'le="+Inf"')} ${s.count}`);
      lines.push(`${h.name}_sum${withLabels(key)} ${s.sum}`);
      lines.push(`${h.name}_count${withLabels(key)} ${s.count}`);
    }
  }

  const mem = process.memoryUsage();
  lines.push(
    '# HELP process_uptime_seconds Seconds since this process started.',
    '# TYPE process_uptime_seconds gauge',
    `process_uptime_seconds ${process.uptime()}`,
    '# HELP process_resident_memory_bytes Resident set size in bytes.',
    '# TYPE process_resident_memory_bytes gauge',
    `process_resident_memory_bytes ${mem.rss}`,
    '# HELP nodejs_heap_used_bytes V8 heap in use, in bytes.',
    '# TYPE nodejs_heap_used_bytes gauge',
    `nodejs_heap_used_bytes ${mem.heapUsed}`
  );

  return `${lines.join('\n')}\n`;
}

// ---- The project's metrics -------------------------------------------------

const httpRequestsTotal = counter('http_requests_total', 'HTTP requests handled, by method, route pattern and status.');
const httpRequestDuration = histogram('http_request_duration_seconds', 'HTTP request duration in seconds, by method and route pattern.');
const cacheLookups = counter('redirect_cache_lookups_total', 'Redirect cache lookups, result="hit" or "miss".');
const clicksEnqueued = counter('click_events_enqueued_total', 'Click events accepted onto the BullMQ queue.');
const clicksDropped = counter('click_events_dropped_total', 'Click events dropped (queue unavailable or too many pending).');
const rateLimited = counter('rate_limited_total', 'Requests rejected with 429, by limiter.');

module.exports = {
  counter,
  histogram,
  render,
  httpRequestsTotal,
  httpRequestDuration,
  cacheLookups,
  clicksEnqueued,
  clicksDropped,
  rateLimited,
  CONTENT_TYPE: 'text/plain; version=0.0.4; charset=utf-8',
};
