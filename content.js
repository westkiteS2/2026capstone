/**
 * content.js
 * 비밀번호 입력 감지, 분석 패널 생성 및 결과 표시를 담당하는 메인 컨트롤러.
 */

// ─── 브릿지 함수들 ──────────────────────────────────────────────────────────
function debounce(fn, delay) {
  return window.PwUtils.debounce(fn, delay)
}
function getSiteName() {
  const host = window.location.hostname || ''
  const parts = host.replace(/^www\./, '').split('.')
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0]
}
function isVisiblePasswordInput(el) {
  return window.PwUtils.isPasswordInput(el)
}
async function sha1(text) {
  return window.PwUtils.sha1Hex(text)
}
function analyzePassword(password, siteName, reuseCount = 0) {
  return window.PwAnalyzer.evaluatePassword(password, { siteName, reuseCount })
}

function normalizeAnalyzerResult(result) {
  return {
    score: result.score,
    status: result.statusClass || 'danger',
    warnings: result.warnings || [],
  }
}

;(function () {
  'use strict'

  const PANEL_ID = 'pwguard-panel'
  const PANEL_CLASS = 'pwguard-panel'
  const DEBOUNCE_DELAY = 300
  const REUSE_DELAY = 800

  let activeInput = null
  let panel = null
  let strengthDebounceTimer = null
  let reuseDebounceTimer = null
  let isDetailOpen = false
  let isMinimized = false

  // 드래그 상태 변수
  let isDragging = false
  let offset = { x: 0, y: 0 }

  // ─── 패널 생성 ───────────────────────────────────────────────────────────────
  function createPanel() {
    if (document.getElementById(PANEL_ID)) {
      panel = document.getElementById(PANEL_ID)
      return
    }

    panel = document.createElement('div')
    panel.id = PANEL_ID
    panel.className = PANEL_CLASS
    panel.setAttribute('role', 'status')
    panel.setAttribute('aria-live', 'polite')

    // 스타일 초기화 (위치는 positionPanel에서 결정)
    panel.style.position = 'absolute'
    panel.style.zIndex = '2147483647'
    panel.style.display = 'none'

    panel.innerHTML = `
      <div class="pwguard-header" style="cursor: move;" title="드래그하여 이동 / 더블 클릭하여 접기">
        <span class="pwguard-title">비밀번호 보안 분석</span>
        <div class="pwguard-controls">
          <button class="pwguard-minimize-btn" title="최소화">-</button>
          <button class="pwguard-close" aria-label="닫기">✕</button>
        </div>
      </div>
      <div class="pwguard-body">
        <div class="pwguard-score-row">
          <span class="pwguard-status-badge">—</span>
          <span class="pwguard-score-text">대기 중</span>
        </div>
        <div class="pwguard-strength-bar-wrap">
          <div class="pwguard-strength-bar" style="width:0%"></div>
        </div>
        <ul class="pwguard-warnings" aria-label="경고 목록"></ul>
        <div class="pwguard-reuse-section" style="display:none">
          <div class="pwguard-reuse-header">
            <span class="pwguard-reuse-badge">⚠ 재사용 감지</span>
            <button class="pwguard-detail-toggle" aria-expanded="false">자세히 보기 ▾</button>
          </div>
          <ul class="pwguard-reuse-warnings" aria-label="재사용 경고"></ul>
          <ul class="pwguard-reuse-details" aria-label="재사용 상세 정보" style="display:none"></ul>
        </div>
      </div>
    `

    document.body.appendChild(panel)

    const header = panel.querySelector('.pwguard-header')

    // 드래그 로직
    header.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return
      isDragging = true
      panel.classList.add('is-dragging')

      // 드래그 시작 시 좌표를 absolute 기반으로 전환하여 계산
      const rect = panel.getBoundingClientRect()
      offset.x = e.clientX - rect.left
      offset.y = e.clientY - rect.top

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    })

    function onMouseMove(e) {
      if (!isDragging || !panel) return

      // 드래그 중에는 fixed처럼 보이게 하기 위해 scroll을 더해 absolute 좌표 계산
      let newX = e.clientX - offset.x + window.scrollX
      let newY = e.clientY - offset.y + window.scrollY

      panel.style.left = newX + 'px'
      panel.style.top = newY + 'px'
    }

    function onMouseUp() {
      isDragging = false
      if (panel) panel.classList.remove('is-dragging')
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    header.addEventListener('dblclick', (e) => {
      if (e.target.tagName !== 'BUTTON') toggleMinimize()
    })

    panel
      .querySelector('.pwguard-minimize-btn')
      .addEventListener('click', (e) => {
        e.stopPropagation()
        toggleMinimize()
      })

    panel.querySelector('.pwguard-close').addEventListener('click', (e) => {
      e.stopPropagation()
      hidePanel()
    })

    panel
      .querySelector('.pwguard-detail-toggle')
      .addEventListener('click', () => {
        isDetailOpen = !isDetailOpen
        const detailList = panel.querySelector('.pwguard-reuse-details')
        const toggleBtn = panel.querySelector('.pwguard-detail-toggle')
        if (detailList && toggleBtn) {
          detailList.style.display = isDetailOpen ? 'block' : 'none'
          toggleBtn.textContent = isDetailOpen ? '접기 ▴' : '자세히 보기 ▾'
          toggleBtn.setAttribute('aria-expanded', String(isDetailOpen))
        }
      })
  }

  // ─── 초기 위치 계산 로직 (첫 번째 파일 방식) ──────────────────────────
  function positionPanel(inputEl) {
    if (!panel || !inputEl) return

    const rect = inputEl.getBoundingClientRect()
    const panelWidth = 280
    const PANEL_GAP = 12

    // 첫 번째 파일의 위치 계산 로직 적용
    let left = rect.right + window.scrollX + PANEL_GAP
    let top = rect.top + window.scrollY

    const viewportRight = window.scrollX + window.innerWidth
    const fitsRight = left + panelWidth <= viewportRight - 12

    // 우측에 공간이 없으면 좌측 또는 상단/하단으로 조정하는 로직
    if (!fitsRight) {
      left = rect.left + window.scrollX - panelWidth - PANEL_GAP
      if (left < 12) {
        left = rect.left + window.scrollX
        top = rect.bottom + window.scrollY + PANEL_GAP
      }
    }

    panel.style.left = left + 'px'
    panel.style.top = top + 'px'
  }

  function toggleMinimize() {
    if (!panel) return
    isMinimized = !isMinimized
    if (isMinimized) {
      panel.classList.add('minimized')
      panel.querySelector('.pwguard-minimize-btn').textContent = '+'
    } else {
      panel.classList.remove('minimized')
      panel.querySelector('.pwguard-minimize-btn').textContent = '-'
    }
  }

  function showPanel(inputEl) {
    if (!panel) createPanel()
    if (!inputEl) return

    // 패널 표시 및 위치 초기화 (입력창 옆으로)
    positionPanel(inputEl)

    if (!inputEl.value) {
      renderStrength({
        score: 0,
        status: 'waiting',
        statusClass: 'waiting',
        warnings: ['비밀번호 입력 시 분석이 시작됩니다.'],
        passed: [],
      })
    } else {
      const domain = getSiteName()
      const result = analyzePassword(inputEl.value, domain, 0)
      renderStrength(normalizeAnalyzerResult(result))
    }

    panel.style.display = 'block'
  }

  function hidePanel() {
    if (panel) panel.style.display = 'none'
    isDetailOpen = false
  }

  function renderStrength(result, reuseResult = null) {
    if (!panel) return
    const badge = panel.querySelector('.pwguard-status-badge')
    const scoreText = panel.querySelector('.pwguard-score-text')
    const bar = panel.querySelector('.pwguard-strength-bar')
    const warningList = panel.querySelector('.pwguard-warnings')

    // 재사용 관련 UI 요소 선택
    const reuseSection = panel.querySelector('.pwguard-reuse-section')
    const reuseWarningList = panel.querySelector('.pwguard-reuse-warnings')
    const reuseDetailList = panel.querySelector('.pwguard-reuse-details')

    const statusMap = {
      danger: { label: '위험', cls: 'status-danger' },
      normal: { label: '보통', cls: 'status-normal' },
      safe: { label: '안전', cls: 'status-safe' },
    }

    const s = statusMap[result.status] || statusMap.danger
    if (badge) {
      badge.textContent = s.label
      badge.className = 'pwguard-status-badge ' + s.cls
    }
    if (scoreText)
      scoreText.innerHTML = `점수 : <span class="pwguard-score-num">${result.score}</span> / 100`
    if (bar) {
      bar.style.width = Math.min(100, Math.max(0, result.score)) + '%'
      bar.classList.remove('bar-danger', 'bar-normal', 'bar-safe')
      bar.classList.add('bar-' + result.status)
    }

    // 1. 일반 보안 경고 목록 렌더링
    if (warningList) {
      warningList.innerHTML = ''
      ;(result.warnings || []).forEach((w) => {
        const li = document.createElement('li')
        li.className = 'pwguard-warning-item'
        li.textContent = w
        warningList.appendChild(li)
      })
    }

    // 2. 재사용 및 장기 사용 탐지 결과 렌더링
    if (reuseSection && reuseResult) {
      if (reuseResult.isReused || reuseResult.isLongUsed) {
        // reuse.js에 정의된 메시지 생성 함수 사용
        const messages = window.buildReuseMessages(reuseResult)

        reuseSection.style.display = 'block'

        // 재사용 경고 문구 출력
        if (reuseWarningList) {
          reuseWarningList.innerHTML = messages.warnings
            .map((msg) => `<li class="pwguard-warning-item">${msg}</li>`)
            .join('')
        }

        // 상세 정보 출력
        if (reuseDetailList) {
          reuseDetailList.innerHTML = messages.details
            .map((dtl) => `<li>${dtl}</li>`)
            .join('')
        }
      } else {
        reuseSection.style.display = 'none'
      }
    }
  }

  function handleInput(e) {
    const input = e.target
    const value = input.value
    const domain = getSiteName()

    // 입력 중에도 위치가 어긋나지 않도록 유지
    if (panel && panel.style.display !== 'none' && !isDragging) {
      positionPanel(input)
    }

    clearTimeout(strengthDebounceTimer)
    strengthDebounceTimer = setTimeout(async () => {
      // 1. 재사용 및 장기 사용 분석 실행 (reuse.js 호출)
      const reuseResult = await window.analyzeReuse(value, domain)

      // 2. 분석된 재사용 횟수를 포함하여 비밀번호 강도 계산
      const raw = analyzePassword(value, domain, reuseResult.reuseCount)
      const normalized = normalizeAnalyzerResult(raw)

      // 3. 화면 렌더링 (재사용 결과 포함)
      renderStrength(normalized, reuseResult)
    }, DEBOUNCE_DELAY)
  }

  function handleFocus(e) {
    const input = e.target
    if (!isVisiblePasswordInput(input)) return
    activeInput = input
    showPanel(input)
  }

  function handleBlur() {
    setTimeout(() => {
      if (
        isDragging ||
        (document.activeElement &&
          panel &&
          panel.contains(document.activeElement))
      ) {
        return
      }
    }, 150)
  }

  function attachToPasswordInputs(root) {
    const inputs = root.querySelectorAll('input[type="password"]')
    inputs.forEach((input) => {
      if (input.dataset.pwguardAttached) return
      input.dataset.pwguardAttached = 'true'
      input.addEventListener('focus', handleFocus)
      input.addEventListener('blur', handleBlur)
      input.addEventListener('input', handleInput)
    })
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue
        if (node.matches && node.matches('input[type="password"]')) {
          attachToPasswordInputs(node.parentElement || document)
        } else if (node.querySelector) {
          attachToPasswordInputs(node)
        }
      }
    }
  })

  function init() {
    createPanel()
    attachToPasswordInputs(document)
    observer.observe(document.body, { childList: true, subtree: true })

    // 네이버 등 자동 포커스 대응
    const currentFocused = document.activeElement
    if (currentFocused && isVisiblePasswordInput(currentFocused)) {
      activeInput = currentFocused
      setTimeout(() => showPanel(currentFocused), 150)
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
