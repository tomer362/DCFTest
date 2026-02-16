const companyNameEl = document.getElementById("companyName");
const tickerEl = document.getElementById("ticker");
const regionEl = document.getElementById("region");
const currencyEl = document.getElementById("currency");
const forecastYearsEl = document.getElementById("forecastYears");
const guardrailEl = document.getElementById("stableGrowthGuardrail");
const systemPromptEl = document.getElementById("systemPrompt");
const jsonInputEl = document.getElementById("jsonInput");
const statusEl = document.getElementById("status");
const resultsCardEl = document.getElementById("resultsCard");
const metricsEl = document.getElementById("metrics");
const forecastBodyEl = document.querySelector("#forecastTable tbody");

function pct(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function num(value, currency = "") {
  const formatted = Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
  return currency ? `${currency} ${formatted}` : formatted;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function clampTerminalGrowth(g, riskFreeRate) {
  return Math.min(g, riskFreeRate - 0.001);
}

function buildSystemPrompt() {
  const company = companyNameEl.value.trim() || "Unknown Company";
  const ticker = tickerEl.value.trim() || "N/A";
  const region = regionEl.value.trim() || "N/A";
  const currency = currencyEl.value.trim() || "USD";
  const years = Number(forecastYearsEl.value) || 10;
  const guardrail = guardrailEl.value.trim() || "<= risk-free rate";

  return `You are a valuation analyst following Aswath Damodaran style DCF principles. Return JSON only (no markdown, no prose).

Target company:
- Name: ${company}
- Ticker: ${ticker}
- Region: ${region}
- Currency: ${currency}
- Explicit forecast length: ${years} years

Method requirements (Demodaran-inspired):
1) Use FCFF (firm cash flow) = EBIT(1-tax) - reinvestment.
2) Reinvestment should be linked to expected sales growth using a sales-to-capital ratio.
3) Operating margins and growth should move toward stable long-run levels by terminal year.
4) Terminal growth must respect guardrail: ${guardrail}.
5) Cost of equity should be CAPM-based (risk-free, beta, ERP).
6) WACC should combine cost of equity and after-tax cost of debt using target debt ratio.
7) Use coherent assumptions and avoid impossible combinations (e.g., g >= WACC).

JSON schema required:
{
  "meta": {
    "company_name": "string",
    "ticker": "string",
    "currency": "string",
    "valuation_date": "YYYY-MM-DD",
    "notes": "string"
  },
  "starting_point": {
    "revenue": number,
    "operating_margin": number,
    "tax_rate": number,
    "debt": number,
    "cash": number,
    "shares_outstanding": number,
    "minority_interest": number,
    "cross_holdings": number
  },
  "assumptions": {
    "forecast_years": ${years},
    "revenue_growth": [number, ... length forecast_years],
    "operating_margin_path": [number, ... length forecast_years],
    "tax_rate_path": [number, ... length forecast_years],
    "sales_to_capital_ratio": number,
    "risk_free_rate": number,
    "equity_risk_premium": number,
    "beta": number,
    "pre_tax_cost_of_debt": number,
    "target_debt_ratio": number,
    "terminal_growth_rate": number
  }
}

Output constraints:
- All rates are decimals (0.08 = 8%).
- All currency amounts are in ${currency} millions.
- Arrays must exactly match forecast_years length.
- Return valid JSON object only.`;
}

function validateArray(arr, len, field) {
  if (!Array.isArray(arr) || arr.length !== len) {
    throw new Error(`${field} must be an array with exactly ${len} entries.`);
  }
}

function calculateDcf(data) {
  const { starting_point: start, assumptions } = data;
  const n = Number(assumptions.forecast_years);

  validateArray(assumptions.revenue_growth, n, "revenue_growth");
  validateArray(assumptions.operating_margin_path, n, "operating_margin_path");
  validateArray(assumptions.tax_rate_path, n, "tax_rate_path");

  const costOfEquity = assumptions.risk_free_rate + assumptions.beta * assumptions.equity_risk_premium;
  const afterTaxCostOfDebt = assumptions.pre_tax_cost_of_debt * (1 - assumptions.tax_rate_path[n - 1]);
  const wacc = costOfEquity * (1 - assumptions.target_debt_ratio) + afterTaxCostOfDebt * assumptions.target_debt_ratio;

  const forecastRows = [];
  let revenue = Number(start.revenue);
  let pvFcffTotal = 0;
  let lastFcff = 0;

  for (let i = 0; i < n; i += 1) {
    const growth = assumptions.revenue_growth[i];
    const margin = assumptions.operating_margin_path[i];
    const taxRate = assumptions.tax_rate_path[i];

    const newRevenue = revenue * (1 + growth);
    const ebit = newRevenue * margin;
    const nopat = ebit * (1 - taxRate);
    const reinvestment = (newRevenue - revenue) / assumptions.sales_to_capital_ratio;
    const fcff = nopat - reinvestment;

    const discountFactor = 1 / ((1 + wacc) ** (i + 1));
    const pvFcff = fcff * discountFactor;

    pvFcffTotal += pvFcff;
    lastFcff = fcff;

    forecastRows.push({
      year: i + 1,
      revenue: newRevenue,
      margin,
      ebit,
      taxRate,
      nopat,
      reinvestment,
      fcff,
      discountFactor,
      pvFcff,
    });

    revenue = newRevenue;
  }

  const terminalGrowth = clampTerminalGrowth(assumptions.terminal_growth_rate, assumptions.risk_free_rate);
  if (wacc <= terminalGrowth) {
    throw new Error("Invalid assumptions: WACC must be greater than terminal growth.");
  }

  const terminalFcff = lastFcff * (1 + terminalGrowth);
  const terminalValue = terminalFcff / (wacc - terminalGrowth);
  const pvTerminalValue = terminalValue / ((1 + wacc) ** n);

  const enterpriseValue = pvFcffTotal + pvTerminalValue;
  const equityValue =
    enterpriseValue - Number(start.debt) + Number(start.cash) + Number(start.cross_holdings) - Number(start.minority_interest);
  const valuePerShare = equityValue / Number(start.shares_outstanding);

  return {
    costOfEquity,
    afterTaxCostOfDebt,
    wacc,
    terminalGrowth,
    terminalValue,
    pvTerminalValue,
    enterpriseValue,
    equityValue,
    valuePerShare,
    forecastRows,
  };
}

function renderResults(result, currency) {
  const metrics = [
    ["Cost of Equity", pct(result.costOfEquity)],
    ["After-tax Cost of Debt", pct(result.afterTaxCostOfDebt)],
    ["WACC", pct(result.wacc)],
    ["Terminal Growth Used", pct(result.terminalGrowth)],
    ["PV of Explicit FCFF", num(result.forecastRows.reduce((acc, row) => acc + row.pvFcff, 0), currency)],
    ["PV of Terminal Value", num(result.pvTerminalValue, currency)],
    ["Enterprise Value", num(result.enterpriseValue, currency)],
    ["Equity Value", num(result.equityValue, currency)],
    ["Value per Share", num(result.valuePerShare, currency)],
  ];

  metricsEl.innerHTML = metrics
    .map(
      ([label, value]) => `<div class="metric"><div class="label">${label}</div><div class="value">${value}</div></div>`
    )
    .join("");

  forecastBodyEl.innerHTML = result.forecastRows
    .map(
      (row) => `
      <tr>
        <td>Year ${row.year}</td>
        <td>${num(row.revenue, currency)}</td>
        <td>${pct(row.margin)}</td>
        <td>${num(row.ebit, currency)}</td>
        <td>${pct(row.taxRate)}</td>
        <td>${num(row.nopat, currency)}</td>
        <td>${num(row.reinvestment, currency)}</td>
        <td>${num(row.fcff, currency)}</td>
        <td>${row.discountFactor.toFixed(4)}</td>
        <td>${num(row.pvFcff, currency)}</td>
      </tr>`
    )
    .join("");

  resultsCardEl.hidden = false;
}

function loadExampleJson() {
  const years = Number(forecastYearsEl.value) || 10;
  const growth = Array.from({ length: years }, (_, i) => Math.max(0.03, 0.11 - i * 0.007));
  const margin = Array.from({ length: years }, (_, i) => Math.min(0.31, 0.28 + i * 0.003));
  const tax = Array.from({ length: years }, (_, i) => Math.min(0.24, 0.18 + i * 0.006));

  const example = {
    meta: {
      company_name: companyNameEl.value || "Apple Inc.",
      ticker: tickerEl.value || "AAPL",
      currency: currencyEl.value || "USD",
      valuation_date: "2026-02-16",
      notes: "Example assumptions for demo purposes only.",
    },
    starting_point: {
      revenue: 400000,
      operating_margin: 0.29,
      tax_rate: 0.19,
      debt: 110000,
      cash: 65000,
      shares_outstanding: 15500,
      minority_interest: 0,
      cross_holdings: 0,
    },
    assumptions: {
      forecast_years: years,
      revenue_growth: growth,
      operating_margin_path: margin,
      tax_rate_path: tax,
      sales_to_capital_ratio: 2,
      risk_free_rate: 0.04,
      equity_risk_premium: 0.05,
      beta: 1.1,
      pre_tax_cost_of_debt: 0.05,
      target_debt_ratio: 0.15,
      terminal_growth_rate: 0.03,
    },
  };

  jsonInputEl.value = JSON.stringify(example, null, 2);
}

document.getElementById("generatePrompt").addEventListener("click", () => {
  systemPromptEl.value = buildSystemPrompt();
  setStatus("System prompt generated.");
});

document.getElementById("copyPrompt").addEventListener("click", async () => {
  if (!systemPromptEl.value.trim()) {
    systemPromptEl.value = buildSystemPrompt();
  }

  try {
    await navigator.clipboard.writeText(systemPromptEl.value);
    setStatus("Prompt copied to clipboard.");
  } catch (error) {
    setStatus("Clipboard access failed. Copy manually.", true);
  }
});

document.getElementById("loadExample").addEventListener("click", () => {
  loadExampleJson();
  setStatus("Example JSON loaded.");
});

document.getElementById("calculate").addEventListener("click", () => {
  try {
    const payload = JSON.parse(jsonInputEl.value);
    const result = calculateDcf(payload);
    renderResults(result, payload.meta?.currency || currencyEl.value || "USD");
    setStatus("DCF calculation complete.");
  } catch (error) {
    setStatus(error.message || "Invalid JSON or assumptions.", true);
  }
});

systemPromptEl.value = buildSystemPrompt();
loadExampleJson();
