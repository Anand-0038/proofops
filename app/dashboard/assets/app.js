const state = {
  health: null,
  incidents: [],
  evidence: [],
  issues: [],
  approvals: [],
  metrics: null,
  keeperhub: null,
  selectedIncident: null,
  selectedRecord: null,
  selectedStage: "observe",
  actionTimer: null,
  actionStatus: null,
  theme: "dark",
  useSystemTheme: true,
  evidenceQuery: "",
  evidenceMode: "all",
  evidenceOutcome: "all",
  evidenceLimit: 12,
};

const THEME_STORAGE_KEY = "proofops-theme";
const THEME_MEDIA_QUERY = window.matchMedia("(prefers-color-scheme: dark)");
const EVIDENCE_PAGE_SIZE = 12;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function text(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function dateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "invalid timestamp";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

function compactId(value) {
  const source = text(value, "");
  return source.length > 18
    ? `${source.slice(0, 9)}…${source.slice(-6)}`
    : source || "—";
}

function formatNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? new Intl.NumberFormat().format(numeric)
    : text(value);
}

function setFacts(container, facts) {
  container.replaceChildren();
  for (const [label, value] of facts) {
    const group = element("div");
    group.append(element("dt", "", label), element("dd", "", text(value)));
    container.append(group);
  }
}

function normalizeTheme(raw) {
  return raw === "light" || raw === "dark" ? raw : null;
}

function getStoredTheme() {
  try {
    return normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

function detectTheme() {
  return THEME_MEDIA_QUERY.matches ? "dark" : "light";
}

function applyTheme(theme, { persist = false } = {}) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;

  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.content = theme === "light" ? "#f5f7fb" : "#090c11";
  }

  const toggle = $("#theme-toggle");
  if (toggle) {
    toggle.textContent = theme === "dark" ? "Light mode" : "Dark mode";
    toggle.setAttribute(
      "aria-label",
      `Switch to ${theme === "dark" ? "light" : "dark"} mode`,
    );
    toggle.setAttribute("aria-pressed", String(theme === "light"));
  }

  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // LocalStorage is optional in private contexts.
    }
  }
}

function initTheme() {
  state.useSystemTheme = getStoredTheme() === null;
  const seedTheme = state.useSystemTheme
    ? detectTheme()
    : getStoredTheme();
  applyTheme(seedTheme);
  THEME_MEDIA_QUERY.addEventListener("change", () => {
    if (state.useSystemTheme) {
      applyTheme(detectTheme());
    }
  });
}

function toggleTheme() {
  const next = state.theme === "dark" ? "light" : "dark";
  state.useSystemTheme = false;
  applyTheme(next, { persist: true });
}

function validHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function verifiedExternalUrl(record, value) {
  if (
    record.evidenceMode !== "fixture" &&
    /^0x[a-fA-F0-9]{64}$/.test(record.txHash ?? "") &&
    validHttps(record.explorerUrl) &&
    validHttps(record.keeperhubAuditReference)
  ) {
    return validHttps(value);
  }
  return null;
}

function isVerifiedLiveRecord(record) {
  return (
    record?.status === "confirmed" &&
    Boolean(verifiedExternalUrl(record, record.explorerUrl)) &&
    Boolean(verifiedExternalUrl(record, record.keeperhubAuditReference))
  );
}

function createVerifiedAnchor(record, value, label) {
  const url = verifiedExternalUrl(record, value);
  if (!url) return null;
  const anchor = element("a", "", label);
  anchor.href = url.href;
  anchor.target = "_blank";
  anchor.rel = "noreferrer noopener";
  return anchor;
}

async function fetchJson(path, options = {}) {
  const response = await fetch(path, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
    ...options,
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message =
      body?.detail ??
      body?.error ??
      `Request failed with HTTP ${response.status}`;
    const hint = body?.hint ? ` ${body.hint}` : "";
    throw new Error(`${message}.${hint}`.replace("..", "."));
  }
  return body;
}

function mutationOptions(token, body = {}) {
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

function setActionStatus(message, tone = "status") {
  const node = $("#action-status");
  window.clearTimeout(state.actionTimer);
  const status = { message, tone };
  state.actionStatus = status;
  node.dataset.state = tone;
  node.textContent = message;
  node.hidden = false;
  state.actionTimer = window.setTimeout(() => {
    if (state.actionStatus === status) state.actionStatus = null;
    node.hidden = true;
  }, 9_000);
}

function showLoadError(error) {
  $("#loading-state").hidden = true;
  $("#error-message").textContent =
    error instanceof Error ? error.message : "The recorder could not be loaded.";
  $("#error-state").hidden = false;
}

function renderReadiness() {
  const health = state.health;
  const local = Boolean(health?.localReady);
  const localStatus = $(".readiness-item");

  localStatus.dataset.ready = String(local);
  $("#local-ready-label").textContent = local ? "LOCAL READY" : "LOCAL NOT READY";
  $("#verified-live-count").textContent = formatNumber(
    Math.max(
      health?.verifiedLiveEvidenceRecords ?? 0,
      state.evidence.filter(isVerifiedLiveRecord).length,
    ),
  );
  $("#evidence-record-count").textContent = formatNumber(
    Math.max(health?.validEvidenceRecords ?? 0, state.evidence.length),
  );
  const keeperhubReady = Boolean(state.keeperhub?.reachable);
  const keeperhubNode = $("#keeperhub-readiness");
  keeperhubNode.dataset.ready = String(keeperhubReady);
  $("#keeperhub-status").textContent = keeperhubReady ? "CONNECTED" : "UNAVAILABLE";
  $("#keeperhub-detail").textContent = keeperhubReady
    ? `${formatNumber(state.keeperhub.toolCount)} MCP tools · server-side`
    : state.keeperhub?.configured
      ? "KeeperHub MCP check failed closed"
      : "KeeperHub key not configured";
}

function publicReceiptAsEvidence(receipt) {
  return {
    runId: receipt.runId,
    workflowId: receipt.keeperhubExecutionId,
    workflowVersion: "public-receipt-v1",
    triggerType: "blockchain_event",
    agentVersion: "published",
    policyVersion: "published",
    chainId: receipt.chainId,
    network: receipt.network,
    evidenceMode: receipt.evidenceMode,
    status: receipt.status,
    createdAt: receipt.confirmedAt,
    submittedAt: receipt.confirmedAt,
    confirmedAt: receipt.confirmedAt,
    policyDecision: "execute",
    policyReasonCode: "verified_public_receipt",
    policyReason: "Published from schema-validated local evidence.",
    decisionRationale: "KeeperHub receipt, explorer transaction, and independent post-state agree.",
    selectedAction: receipt.action,
    simulationResult: receipt.simulation,
    submissionAttempts: receipt.submissionAttempts,
    retryReasons: receipt.retryReasons,
    txHash: receipt.txHash,
    explorerUrl: receipt.explorerUrl,
    keeperhubExecutionId: receipt.keeperhubExecutionId,
    keeperhubAuditReference: receipt.keeperhubAuditReference,
    postState: receipt.postStateVerification,
    conditionRecheck: {
      strategy: "independent_rpc_post_state",
      met: receipt.postStateVerification.ok,
    },
  };
}

function newestEvidence(predicate) {
  return [...state.evidence].reverse().find(predicate) ?? null;
}

function journeyEvidence(kind) {
  if (kind === "live") return newestEvidence(isVerifiedLiveRecord);
  if (kind === "safety") {
    return newestEvidence((record) => record.status === "simulation_blocked");
  }
  return newestEvidence(
    (record) =>
      record.status === "fixture_recovered" ||
      (record.submissionAttempts ?? 0) > 1 ||
      (record.retryReasons ?? []).length > 0,
  );
}

function renderJourneyControls() {
  const live = journeyEvidence("live");
  const controls = [
    ["#inspect-live-proof", live],
    ["#inspect-safety-proof", journeyEvidence("safety")],
    ["#inspect-recovery-proof", journeyEvidence("recovery")],
  ];
  for (const [selector, record] of controls) {
    const button = $(selector);
    button.disabled = !record;
    button.dataset.available = String(Boolean(record));
  }
  $("#live-route-detail").textContent = live
    ? `${compactId(live.runId)} · confirmed on ${live.network}`
    : "No verified live receipt is available in this evidence store";
}

function openJourneyEvidence(kind) {
  const record = journeyEvidence(kind);
  if (!record) {
    setActionStatus("That evidence path is not available in this dataset.", "error");
    return;
  }
  state.selectedStage =
    kind === "safety" ? "simulate" : kind === "recovery" ? "reconcile" : "verify";
  selectRecord(record);
  $("#rail-title").scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
    block: "start",
  });
}

function renderIncidents() {
  const list = $("#incident-list");
  list.replaceChildren();
  $("#incident-count").textContent = formatNumber(state.incidents.length);
  $("#incident-empty").hidden = state.incidents.length > 0;

  for (const incident of state.incidents) {
    const button = element("button", "incident-card");
    button.type = "button";
    button.dataset.incidentId = incident.id;
    button.setAttribute(
      "aria-pressed",
      String(state.selectedIncident?.id === incident.id),
    );
    const topline = element("span", "card-topline");
    topline.append(
      element("span", "", incident.id),
      element("span", "severity", incident.severity),
    );
    button.append(
      topline,
      element("strong", "", incident.title),
      element("p", "", incident.signal),
    );
    button.addEventListener("click", () => {
      state.selectedIncident = incident;
      renderIncidents();
      setActionStatus(
        `${incident.title} selected. Build proof to observe current state.`,
      );
    });
    list.append(button);
  }
}

function trustBadge(mode) {
  const badge = element("span", "trust-badge", String(mode).toUpperCase());
  badge.dataset.mode = mode;
  return badge;
}

function statusTone(status) {
  if (status === "confirmed" || status === "fixture_recovered") return "good";
  if (status === "failed") return "bad";
  if (
    status === "policy_blocked" ||
    status === "simulation_blocked" ||
    status === "approval_required"
  ) {
    return "warn";
  }
  return "neutral";
}

function filteredEvidence() {
  const query = state.evidenceQuery.trim().toLowerCase();
  return [...state.evidence].reverse().filter((record) => {
    if (state.evidenceMode !== "all" && record.evidenceMode !== state.evidenceMode) {
      return false;
    }
    if (
      state.evidenceOutcome !== "all" &&
      record.status !== state.evidenceOutcome
    ) {
      return false;
    }
    if (!query) return true;
    const haystack = [
      record.runId,
      record.workflowId,
      record.status,
      record.policyDecision,
      record.policyReasonCode,
      record.keeperhubExecutionId,
      record.txHash,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

function markSelectedEvidenceRow() {
  for (const row of $$("#evidence-rows tr[data-run-id]")) {
    const selected = row.dataset.runId === state.selectedRecord?.runId;
    row.dataset.selected = String(selected);
    row.querySelector("button")?.setAttribute("aria-pressed", String(selected));
  }
}

function renderEvidenceIndex() {
  const rows = $("#evidence-rows");
  rows.replaceChildren();
  const records = filteredEvidence();
  const visibleRecords = records.slice(0, state.evidenceLimit);
  const hasFilters =
    Boolean(state.evidenceQuery.trim()) ||
    state.evidenceMode !== "all" ||
    state.evidenceOutcome !== "all";
  $("#empty-state").hidden = state.evidence.length > 0;
  $("#evidence-filter-empty").hidden = records.length > 0;

  for (const record of visibleRecords) {
    const row = element("tr");
    row.dataset.runId = record.runId;
    const recorded = element("td", "", dateTime(record.createdAt));
    const idCell = element("td");
    const select = element("button", "", compactId(record.runId));
    select.type = "button";
    select.title = `Inspect evidence ${record.runId}`;
    select.setAttribute(
      "aria-pressed",
      String(record.runId === state.selectedRecord?.runId),
    );
    select.addEventListener("click", () => selectRecord(record));
    idCell.append(select);
    const mode = element("td");
    mode.append(trustBadge(record.evidenceMode));
    const outcome = element("td", "status-cell", record.status);
    outcome.dataset.tone = statusTone(record.status);
    const attempts = element(
      "td",
      "",
      new Intl.NumberFormat().format(record.submissionAttempts ?? 0),
    );
    const source = element("td");
    const sourceLink =
      createVerifiedAnchor(record, record.keeperhubAuditReference, "KeeperHub audit") ??
      element(
        "span",
        "record-source",
        record.evidenceMode === "fixture" ? "local fixture" : "unverified source",
      );
    source.append(sourceLink);
    row.append(recorded, idCell, mode, outcome, attempts, source);
    rows.append(row);
  }

  markSelectedEvidenceRow();
  const shown = visibleRecords.length;
  const total = state.evidence.length;
  $("#evidence-summary").textContent = hasFilters
    ? `Showing ${formatNumber(shown)} of ${formatNumber(records.length)} matched records · ${formatNumber(total)} total`
    : `Showing ${formatNumber(shown)} of ${formatNumber(total)} records`;
  const remaining = Math.max(0, records.length - shown);
  const showMore = $("#show-more-evidence");
  showMore.hidden = remaining === 0;
  showMore.textContent = `Show ${formatNumber(
    Math.min(EVIDENCE_PAGE_SIZE, remaining),
  )} more record${Math.min(EVIDENCE_PAGE_SIZE, remaining) === 1 ? "" : "s"}`;
}

function selectedRecordFacts(record) {
  setFacts($("#context-facts"), [
    ["Run", compactId(record?.runId)],
    ["Recorded", dateTime(record?.createdAt)],
    ["Trigger", record?.triggerType],
    ["Chain", record ? `${record.network} / ${record.chainId}` : null],
    ["Workflow", record?.workflowId],
    ["Version", record?.workflowVersion],
  ]);
  setFacts($("#policy-facts"), [
    ["Verdict", record?.policyDecision],
    ["Reason code", record?.policyReasonCode],
    ["Reason", record?.policyReason],
    ["Action", record?.selectedAction?.functionName],
    ["Target", compactId(record?.selectedAction?.contract)],
    ["Value", record?.selectedAction?.valueWei],
  ]);
  setFacts($("#simulation-facts"), [
    ["Status", record?.simulationResult?.status],
    ["Would revert", record?.simulationResult?.wouldRevert],
    ["Gas estimate", record?.simulationResult?.gasEstimate],
    ["Condition met", record?.simulationResult?.condition?.met],
    ["Observed", record?.simulationResult?.condition?.observedValue],
    ["Target", record?.simulationResult?.condition?.targetValue],
  ]);
  setFacts($("#verification-facts"), [
    ["Outcome", record?.status],
    ["Recheck", record?.conditionRecheck?.strategy],
    ["Condition met", record?.conditionRecheck?.met],
    ["Confirmed", dateTime(record?.confirmedAt)],
    ["Gas used", record?.gasUsed],
    [
      "Post-state",
      record?.postState ? `${Object.keys(record.postState).length} fields` : null,
    ],
  ]);
}

function renderAttempts(record) {
  const list = $("#attempt-list");
  list.replaceChildren();
  const count = record?.submissionAttempts ?? 0;
  $("#attempt-count").textContent = `${formatNumber(count)} ${
    count === 1 ? "submission" : "submissions"
  }`;

  if (!record) {
    list.append(
      timelineItem("No record", "Select evidence to inspect attempt history."),
    );
    return;
  }
  if (count === 0) {
    const reason =
      record.status === "simulation_blocked"
        ? "Simulation stopped the broadcast."
        : record.status === "policy_blocked"
          ? "Deterministic policy stopped the action."
          : record.status === "approval_required"
            ? "Execution waits for a bound human approval."
            : "No KeeperHub broadcast was attempted.";
    list.append(timelineItem("0 attempts", reason));
    return;
  }

  for (let index = 0; index < count; index += 1) {
    const attempt = index + 1;
    const retry = record.retryReasons?.[index - 1];
    const gas = record.gasEstimateChanges?.find(
      (entry) => entry.attempt === attempt,
    );
    const nonce = record.nonceChanges?.find(
      (entry) => entry.attempt === attempt,
    );
    const description = [
      attempt === 1 ? "KeeperHub submission" : "Reconciled retry",
      retry,
      gas?.gasEstimate ? `gas ${gas.gasEstimate}` : null,
      nonce?.note,
    ]
      .filter(Boolean)
      .join(" · ");
    list.append(
      timelineItem(
        attempt === 1 ? dateTime(record.submittedAt) : `attempt ${attempt}`,
        description,
      ),
    );
  }
  list.append(
    timelineItem(
      dateTime(record.confirmedAt),
      record.status === "confirmed"
        ? "Authoritative KeeperHub confirmation reconciled."
        : record.status === "fixture_recovered"
          ? "Fixture recovery completed; no chain claim made."
          : `Terminal outcome: ${record.status}.`,
    ),
  );
}

function timelineItem(label, description) {
  const item = element("li");
  item.append(
    element("time", "", label),
    element("span", "", description),
  );
  return item;
}

function renderVerifiedLinks(record) {
  const container = $("#verified-links");
  container.replaceChildren();
  if (!record) return;
  const explorer = createVerifiedAnchor(record, record.explorerUrl, "Verified transaction ↗");
  const audit = createVerifiedAnchor(
    record,
    record.keeperhubAuditReference,
    "KeeperHub audit trail ↗",
  );
  if (explorer) container.append(explorer);
  if (audit) container.append(audit);
}

const stageCopy = {
  observe: {
    index: "01",
    title: "Observation captured",
    summary:
      "The recorder freezes the protocol inputs, source timestamps, trigger, and trust mode that opened the incident.",
  },
  policy: {
    index: "02",
    title: "Deterministic policy evaluated",
    summary:
      "Action value, target, severity, allowlist, and reason code are evaluated before any simulation or broadcast.",
  },
  approval: {
    index: "03",
    title: "Human authority bound",
    summary:
      "When required, approval binds to the exact call fingerprint and expires. It never lowers the original severity.",
  },
  simulate: {
    index: "04",
    title: "KeeperHub simulation gated",
    summary:
      "The same call intent is simulated before execution. A revert or false condition produces a proof, not a transaction.",
  },
  execute: {
    index: "05",
    title: "KeeperHub execution submitted",
    summary:
      "KeeperHub is the only state-changing authority. ProofOps does not hold or use a local transaction signer.",
  },
  reconcile: {
    index: "06",
    title: "Ambiguous outcomes reconciled",
    summary:
      "Retries preserve the idempotency key for identical bodies and poll the original execution before considering a new intent.",
  },
  verify: {
    index: "07",
    title: "Post-state verified",
    summary:
      "The terminal receipt is checked against the protocol post-state and the condition that authorized the mitigation.",
  },
  anchor: {
    index: "08",
    title: "Proof manifest anchored",
    summary:
      "The portable bundle hashes every artifact. Live runs can anchor that manifest through KeeperHub ActionLog execution.",
  },
};

function stageFacts(stage, record) {
  if (!record) return [["State", "awaiting evidence"]];
  switch (stage) {
    case "observe":
      return [
        ["Trust mode", record.evidenceMode],
        ["Trigger", record.triggerType],
        ["Input fields", Object.keys(record.observedInputs ?? {}).length],
        ["Source clocks", Object.keys(record.dataSourceTimestamps ?? {}).length],
      ];
    case "policy":
      return [
        ["Verdict", record.policyDecision],
        ["Reason code", record.policyReasonCode],
        ["Severity proof", record.decisionRationale],
        ["Policy", record.policyVersion],
      ];
    case "approval":
      return [
        ["Outcome", record.status],
        [
          "Human gate",
          record.policyDecision === "approval_required" ? "required" : "not required",
        ],
        ["Action", record.selectedAction?.functionName],
        ["Target", compactId(record.selectedAction?.contract)],
      ];
    case "simulate":
      return [
        ["Result", record.simulationResult?.status],
        ["Would revert", record.simulationResult?.wouldRevert],
        ["Condition", record.simulationResult?.condition?.met],
        ["Gas estimate", record.simulationResult?.gasEstimate],
      ];
    case "execute":
      return [
        ["Submissions", record.submissionAttempts],
        ["Execution", compactId(record.keeperhubExecutionId)],
        ["Transaction", compactId(record.txHash)],
        ["Authority", "KeeperHub"],
      ];
    case "reconcile":
      return [
        ["Retries", record.retryReasons?.length ?? 0],
        ["Nonce records", record.nonceChanges?.length ?? 0],
        ["Gas records", record.gasEstimateChanges?.length ?? 0],
        ["Terminal status", record.status],
      ];
    case "verify":
      return [
        ["Recheck", record.conditionRecheck?.strategy],
        ["Condition met", record.conditionRecheck?.met],
        ["Post-state", record.postState ? "captured" : "not captured"],
        ["Confirmed", dateTime(record.confirmedAt)],
      ];
    case "anchor":
      return [
        [
          "Audit source",
          verifiedExternalUrl(record, record.keeperhubAuditReference)
            ? "verified HTTPS"
            : "no verified live link",
        ],
        ["Proof export", "SHA-256 manifest"],
        ["Trust mode", record.evidenceMode],
        ["Live claim", record.status === "confirmed" ? "confirmed" : "not claimed"],
      ];
    default:
      return [];
  }
}

function stageState(stage, record) {
  if (!record) return "pending";
  const status = record.status;
  if (stage === "observe" || stage === "policy") return "complete";
  if (stage === "approval") {
    return status === "approval_required" ? "blocked" : "complete";
  }
  if (stage === "simulate") {
    return status === "simulation_blocked"
      ? "blocked"
      : record.simulationResult
        ? "complete"
        : "pending";
  }
  if (stage === "execute") {
    if (
      status === "policy_blocked" ||
      status === "approval_required" ||
      status === "simulation_blocked"
    ) {
      return "blocked";
    }
    return (record.submissionAttempts ?? 0) > 0 ? "complete" : "pending";
  }
  if (stage === "reconcile") {
    return (record.submissionAttempts ?? 0) > 0 ? "complete" : "pending";
  }
  if (stage === "verify") {
    return ["confirmed", "fixture_recovered", "skipped"].includes(status)
      ? "complete"
      : "pending";
  }
  if (stage === "anchor") {
    return verifiedExternalUrl(record, record.keeperhubAuditReference)
      ? "complete"
      : "pending";
  }
  return "pending";
}

function renderStage() {
  const selected = state.selectedStage;
  const copy = stageCopy[selected];
  for (const button of $$(".rail-stage")) {
    const active = button.dataset.stage === selected;
    button.setAttribute("aria-expanded", String(active));
    button.dataset.state = stageState(button.dataset.stage, state.selectedRecord);
  }
  $("#stage-kicker").textContent = `CHECKPOINT ${copy.index}`;
  $("#stage-title").textContent = copy.title;
  $("#stage-summary").textContent = copy.summary;
  setFacts($("#stage-facts"), stageFacts(selected, state.selectedRecord));
}

function selectRecord(record) {
  state.selectedRecord = record;
  const mode = record?.evidenceMode ?? "fixture";
  $("#selected-run-id").textContent = record?.runId ?? "waiting for evidence";
  $("#record-mode").textContent = mode.toUpperCase();
  $("#record-mode").dataset.mode = mode;
  $("#truth-title").textContent =
    mode === "live"
      ? record?.status === "confirmed"
        ? "A live receipt is bound to a real execution and verified post-state."
        : "A live observation is not automatically a transaction."
      : mode === "mixed"
        ? "Mixed evidence separates fixture observation from live execution."
        : "A fixture is a rehearsal, never a transaction.";
  $("#mode-explanation").textContent =
    mode === "live"
      ? "Explorer and KeeperHub audit links appear only after the full live receipt validates."
      : mode === "mixed"
        ? "Fixture observation and live execution are labeled together; inspect both sources."
        : "Explorer and KeeperHub audit links are suppressed because this is local rehearsal evidence.";
  selectedRecordFacts(record);
  renderAttempts(record);
  renderVerifiedLinks(record);
  $("#raw-evidence").textContent = record
    ? JSON.stringify(record, null, 2)
    : "No evidence selected.";
  renderStage();
  markSelectedEvidenceRow();
}

function renderApprovals() {
  const list = $("#approval-list");
  list.replaceChildren();
  $("#approval-count").textContent = formatNumber(state.approvals.length);
  $("#approval-empty").hidden = state.approvals.length > 0;

  for (const approval of state.approvals) {
    const card = element("article", "approval-card");
    const topline = element("div", "card-topline");
    topline.append(
      element("span", "", compactId(approval.id)),
      element("span", "severity", approval.action?.severity ?? "bounded"),
    );
    const button = element("button", "primary-button");
    button.type = "button";
    button.append(
      element("span", "", "Approve exact action"),
      element("span", "", "→"),
    );
    button.addEventListener("click", () => applyApproval(approval, button));
    card.append(
      topline,
      element("strong", "", approval.action?.functionName ?? "Mitigation"),
      element("p", "", approval.rationale),
      element(
        "p",
        "",
        `Expires ${dateTime(approval.expiresAt)} · ${compactId(
          approval.actionFingerprint,
        )}`,
      ),
      button,
    );
    list.append(card);
  }
}

async function applyApproval(approval, button) {
  const token = $("#operator-token").value.trim();
  if (!token) {
    $("#operator-token").focus();
    setActionStatus("Paste the local operator token before approving.", "error");
    return;
  }
  button.disabled = true;
  button.firstElementChild.textContent = "Executing through KeeperHub…";
  try {
    const result = await fetchJson(
      `/api/approvals/${encodeURIComponent(approval.id)}/apply`,
      mutationOptions(token),
    );
    setActionStatus(
      result.evidenceMode === "fixture"
        ? `Fixture recovery recorded for ${compactId(result.runId)}. No live transaction claimed.`
        : `Execution returned ${result.status}. Inspect the verified receipt.`,
    );
    await loadConsole({ preserveSelection: false, preserveActionStatus: true });
  } catch (error) {
    setActionStatus(
      error instanceof Error ? error.message : "Approval failed safely.",
      "error",
    );
    button.disabled = false;
    button.firstElementChild.textContent = "Approve exact action";
  }
}

async function buildProof(event) {
  event.preventDefault();
  const token = $("#operator-token").value.trim();
  if (!token) {
    $("#operator-token").focus();
    setActionStatus("Paste the local operator token to build a proposal.", "error");
    return;
  }
  const button = $("#build-proof");
  button.disabled = true;
  button.firstElementChild.textContent = "Observing & evaluating…";
  try {
    const result = await fetchJson(
      "/api/cycle",
      mutationOptions(token, {
        incidentId: state.selectedIncident?.id ?? null,
      }),
    );
    const statement =
      result.status === "approval_required"
        ? "Policy proof built. Exact action now awaits human approval."
        : `Mitigation proof recorded with outcome: ${result.status}.`;
    setActionStatus(statement);
    await loadConsole({ preserveSelection: false, preserveActionStatus: true });
  } catch (error) {
    setActionStatus(
      error instanceof Error ? error.message : "Proposal failed safely.",
      "error",
    );
  } finally {
    button.disabled = false;
    button.firstElementChild.textContent = "Build mitigation proof";
  }
}

async function loadConsole({
  preserveSelection = true,
  preserveActionStatus = false,
} = {}) {
  $("#loading-state").hidden = false;
  $("#error-state").hidden = true;
  try {
    const [health, incidents, evidence, metrics, approvals, publicEvidence, keeperhub] = await Promise.all([
      fetchJson("/api/health"),
      fetchJson("/api/incidents"),
      fetchJson("/api/evidence"),
      fetchJson("/api/metrics"),
      fetchJson("/api/approvals"),
      fetchJson("/api/public-evidence").catch(() => ({ ledger: { receipts: [] } })),
      fetchJson("/api/integrations/keeperhub").catch(() => ({
        configured: false,
        reachable: false,
        toolCount: 0,
      })),
    ]);
    state.health = health;
    state.incidents = incidents.incidents ?? [];
    const published = (publicEvidence.ledger?.receipts ?? []).map(publicReceiptAsEvidence);
    const localRunIds = new Set((evidence.records ?? []).map((record) => record.runId));
    state.evidence = [
      ...published.filter((record) => !localRunIds.has(record.runId)),
      ...(evidence.records ?? []),
    ];
    state.issues = evidence.issues ?? [];
    state.metrics = metrics;
    state.approvals = approvals.approvals ?? [];
    state.keeperhub = keeperhub;
    state.selectedIncident ??= state.incidents[1] ?? state.incidents[0] ?? null;

    const retained = preserveSelection
      ? state.evidence.find(
          (record) => record.runId === state.selectedRecord?.runId,
        )
      : null;
    state.selectedRecord =
      retained ?? journeyEvidence("live") ?? state.evidence[state.evidence.length - 1] ?? null;

    renderReadiness();
    renderJourneyControls();
    renderIncidents();
    renderEvidenceIndex();
    renderApprovals();
    selectRecord(state.selectedRecord);
    if (state.issues.length > 0 && !preserveActionStatus) {
      setActionStatus(
        `${state.issues.length} malformed evidence row(s) quarantined and excluded.`,
        "error",
      );
    }
    $("#loading-state").hidden = true;
  } catch (error) {
    showLoadError(error);
  }
}

function resetEvidenceFilters() {
  state.evidenceQuery = "";
  state.evidenceMode = "all";
  state.evidenceOutcome = "all";
  state.evidenceLimit = EVIDENCE_PAGE_SIZE;
  $("#evidence-search").value = "";
  $("#evidence-trust-filter").value = "all";
  $("#evidence-outcome-filter").value = "all";
  renderEvidenceIndex();
}

function bindEvents() {
  $("#cycle-form").addEventListener("submit", buildProof);
  $("#refresh-console").addEventListener("click", () => loadConsole());
  $("#theme-toggle").addEventListener("click", toggleTheme);
  $("#retry-load").addEventListener("click", () => loadConsole());
  $("#inspect-live-proof").addEventListener("click", () =>
    openJourneyEvidence("live"),
  );
  $("#inspect-safety-proof").addEventListener("click", () =>
    openJourneyEvidence("safety"),
  );
  $("#inspect-recovery-proof").addEventListener("click", () =>
    openJourneyEvidence("recovery"),
  );
  $("#evidence-search").addEventListener("input", (event) => {
    state.evidenceQuery = event.currentTarget.value;
    state.evidenceLimit = EVIDENCE_PAGE_SIZE;
    renderEvidenceIndex();
  });
  $("#evidence-trust-filter").addEventListener("change", (event) => {
    state.evidenceMode = event.currentTarget.value;
    state.evidenceLimit = EVIDENCE_PAGE_SIZE;
    renderEvidenceIndex();
  });
  $("#evidence-outcome-filter").addEventListener("change", (event) => {
    state.evidenceOutcome = event.currentTarget.value;
    state.evidenceLimit = EVIDENCE_PAGE_SIZE;
    renderEvidenceIndex();
  });
  $("#reset-evidence-filters").addEventListener("click", resetEvidenceFilters);
  $("#show-more-evidence").addEventListener("click", () => {
    state.evidenceLimit += EVIDENCE_PAGE_SIZE;
    renderEvidenceIndex();
  });
  $("#toggle-token").addEventListener("click", (event) => {
    const input = $("#operator-token");
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    event.currentTarget.textContent = showing ? "Show" : "Hide";
    event.currentTarget.setAttribute("aria-pressed", String(!showing));
    event.currentTarget.setAttribute(
      "aria-label",
      showing ? "Show operator token" : "Hide operator token",
    );
  });
  for (const button of $$(".rail-stage")) {
    button.addEventListener("click", () => {
      state.selectedStage = button.dataset.stage;
      renderStage();
      $("#stage-detail").focus({ preventScroll: true });
    });
  }
}

bindEvents();
renderStage();
initTheme();
loadConsole();
