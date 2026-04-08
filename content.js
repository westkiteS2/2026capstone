(() => {
  const { debounce, getSiteName, isPasswordInput } = window.PwUtils;
  const { evaluatePassword } = window.PwAnalyzer;

  const PANEL_ID = "pw-helper-panel";
  const PANEL_WIDTH = 320;
  const PANEL_GAP = 12;

  let panel = null;
  let activeInput = null;
  let latestAsyncState = {
    reused: false,
    leaked: false,
  };

  function createPanel() {
    const el = document.createElement("div");
    el.id = PANEL_ID;
    el.style.display = "none";
    el.innerHTML = `
      <div class="pw-panel-header">
        <div class="pw-panel-title">비밀번호 보안 분석</div>
        <div class="pw-panel-badge">실시간</div>
      </div>

      <div class="pw-panel-row">
        <span class="pw-label">점수</span>
        <strong id="pw-score-value">0</strong>
        <span class="pw-unit">/100</span>
      </div>

      <div class="pw-panel-row">
        <span class="pw-label">상태</span>
        <strong id="pw-status-value" class="pw-status waiting">입력 대기</strong>
      </div>

      <div class="pw-panel-section-title">확인 항목</div>
      <ul id="pw-warning-list" class="pw-warning-list">
        <li>비밀번호 입력 시 분석 시작</li>
      </ul>

      <div id="pw-extra-info" class="pw-extra-info"></div>
    `;
    document.body.appendChild(el);
    return el;
  }

  function getPanel() {
    if (!panel) {
      panel = createPanel();
    }
    return panel;
  }

  function showPanel() {
    getPanel().style.display = "block";
  }

  function hidePanel() {
    if (panel) {
      panel.style.display = "none";
    }
  }

  function renderResult(result, extra = {}) {
    const panelEl = getPanel();

    const scoreEl = panelEl.querySelector("#pw-score-value");
    const statusEl = panelEl.querySelector("#pw-status-value");
    const warningList = panelEl.querySelector("#pw-warning-list");
    const extraInfoEl = panelEl.querySelector("#pw-extra-info");

    scoreEl.textContent = result.score;
    statusEl.textContent = result.status;
    statusEl.className = `pw-status ${result.statusClass}`;

    warningList.innerHTML = "";
    result.warnings.forEach((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      warningList.appendChild(li);
    });

    const extras = [];

    if (extra.reuseCount > 0) {
      extras.push(`재사용 의심: ${extra.reuseCount}개 사이트`);
    }

    if (extra.leaked === true) {
      extras.push("유출 의심: 확인 필요");
    }

    extraInfoEl.textContent = extras.join(" · ");
  }

  function positionPanel(input) {
    const panelEl = getPanel();
    if (!input || !isPasswordInput(input)) {
      hidePanel();
      return;
    }

    showPanel();

    panelEl.style.width = `${PANEL_WIDTH}px`;

    const rect = input.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    const panelHeight = panelEl.offsetHeight || 180;

    let left = rect.right + scrollX + PANEL_GAP;
    let top = rect.top + scrollY;

    const viewportRight = scrollX + window.innerWidth;
    const fitsRight = left + PANEL_WIDTH <= viewportRight - 12;

    if (!fitsRight) {
      left = rect.left + scrollX;
      top = rect.top + scrollY - panelHeight - PANEL_GAP;

      if (top < scrollY + 12) {
        top = rect.bottom + scrollY + PANEL_GAP;
      }
    }

    if (left < 12) left = 12;
    const maxLeft = scrollX + window.innerWidth - PANEL_WIDTH - 12;
    if (left > maxLeft) left = maxLeft;

    panelEl.style.left = `${left}px`;
    panelEl.style.top = `${top}px`;
  }

  function renderForPassword(password) {
    const result = evaluatePassword(password, {
      siteName: getSiteName(),
      reused: latestAsyncState.reused,
      leaked: latestAsyncState.leaked,
    });

    renderResult(result, {
      reuseCount: latestAsyncState.reuseCount || 0,
      leaked: latestAsyncState.leaked,
    });
  }

  async function runFutureChecks(password) {
    if (!password) {
      latestAsyncState = { reused: false, leaked: false, reuseCount: 0 };
      renderForPassword(password);
      return;
    }

    /*
      여기부터 나중에 추가할 자리

      1) 재사용 분석
         - password를 해시로 변환
         - chrome.storage.local에서 기존 기록 비교
         - latestAsyncState.reused / reuseCount 갱신

      2) 유출 여부 검사
         - SHA-1 해시 생성
         - prefix 5글자 기준 외부 조회 or service worker 메시지 전달
         - latestAsyncState.leaked 갱신

      지금은 안정성 우선이라 기본값만 유지
    */

    latestAsyncState = {
      reused: false,
      leaked: false,
      reuseCount: 0,
    };

    renderForPassword(password);
  }

  const debouncedFutureChecks = debounce(runFutureChecks, 500);

  function activateInput(input) {
    if (!isPasswordInput(input)) return;

    activeInput = input;
    positionPanel(input);
    renderForPassword(input.value || "");
  }

  function handleFocusIn(event) {
    const target = event.target;
    if (!isPasswordInput(target)) return;

    activateInput(target);
  }

  function handleInput(event) {
    const target = event.target;
    if (!isPasswordInput(target)) return;

    activeInput = target;
    latestAsyncState = {
      reused: false,
      leaked: false,
      reuseCount: 0,
    };

    renderForPassword(target.value || "");
    positionPanel(target);
    debouncedFutureChecks(target.value || "");
  }

  function handleFocusOut(event) {
    const target = event.target;
    if (!target || target.tagName !== "INPUT" || target.type !== "password")
      return;

    setTimeout(() => {
      if (!isPasswordInput(document.activeElement)) {
        hidePanel();
        activeInput = null;
      }
    }, 80);
  }

  function handleViewportChange() {
    if (activeInput && isPasswordInput(activeInput)) {
      positionPanel(activeInput);
    }
  }

  function init() {
    getPanel();

    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("input", handleInput, true);
    document.addEventListener("focusout", handleFocusOut, true);

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
