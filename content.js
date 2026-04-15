/**
 * content.js
 * 비밀번호 보안 분석 패널 메인 컨트롤러
 * 기능: 드래그, 최소화, 강도 분석 연동, 재사용 탐지 연동, 사이트 목록 토글
 */

// ─── 브릿지 함수들 (외부 JS 의존성 연결) ──────────────────────────────────────
const getSiteName = () => {
  const host = window.location.hostname || ''
  const parts = host.replace(/^www\./, '').split('.')
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0]
}

const isVisiblePasswordInput = (el) =>
  window.PwUtils?.isPasswordInput(el) ?? el?.type === 'password'

const normalizeAnalyzerResult = (result) => ({
  score: result?.score || 0,
  status: result?.statusClass || 'danger',
  warnings: result?.warnings || [],
})

;(function () {
  'use strict'

  // ─── 상수 및 상태 관리 ────────────────────────────────────────────────────────
  const PANEL_ID = 'pwguard-panel'
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

  // ─── 패널 생성 및 초기화 ──────────────────────────────────────────────────────
  function createPanel() {
    if (document.getElementById(PANEL_ID)) {
      panel = document.getElementById(PANEL_ID)
      return
    }

    panel = document.createElement('div')
    panel.id = PANEL_ID
    panel.className = 'pwguard-panel'
    panel.style.cssText =
      'position: absolute; z-index: 2147483647; display: none;'

    panel.innerHTML = `
      <div class="pwguard-header" style="cursor: move;" title="드래그 이동 / 더블클릭 최소화">
        <span class="pwguard-title">🔒 비밀번호 보안 분석</span>
        <div class="pwguard-controls">
          <button class="pwguard-minimize-btn" title="최소화">-</button>
          <button class="pwguard-close" aria-label="닫기">✕</button>
        </div>
      </div>
      <div class="pwguard-body">
        <div class="pwguard-score-row">
          <span class="pwguard-status-badge">—</span>
          <span class="pwguard-score-text">입력 대기 중</span>
        </div>
        <div class="pwguard-strength-bar-wrap">
          <div class="pwguard-strength-bar" style="width:0%"></div>
        </div>
        <ul class="pwguard-warnings"></ul>

        <div class="pwguard-reuse-section" style="display:none">
          <div class="pwguard-reuse-header">
            <span class="pwguard-reuse-badge">⚠️ 재사용 감지</span>
            <button class="pwguard-detail-toggle">자세히 보기 ▾</button>
          </div>
          <ul class="pwguard-reuse-warnings"></ul>
          <ul class="pwguard-reuse-details" style="display:none"></ul>
        </div>

        <div class="pwguard-longuse-section" style="display:none">
          <span class="pwguard-longuse-badge">🕐 장기 사용 감지</span>
          <ul class="pwguard-longuse-warnings"></ul>
        </div>
      </div>
    `

    document.body.appendChild(panel)
    setupPanelEvents()
  }

  function setupPanelEvents() {
    const header = panel.querySelector('.pwguard-header')

    // 드래그 시작
    header.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return
      isDragging = true
      const rect = panel.getBoundingClientRect()
      offset.x = e.clientX - rect.left
      offset.y = e.clientY - rect.top
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    })

    header.addEventListener('dblclick', (e) => {
      if (e.target.tagName !== 'BUTTON') toggleMinimize()
    })

    panel.querySelector('.pwguard-minimize-btn').onclick = (e) => {
      e.stopPropagation()
      toggleMinimize()
    }

    panel.querySelector('.pwguard-close').onclick = (e) => {
      e.stopPropagation()
      hidePanel()
    }

    panel.querySelector('.pwguard-detail-toggle').onclick = (e) => {
      isDetailOpen = !isDetailOpen
      const detailList = panel.querySelector('.pwguard-reuse-details')
      detailList.style.display = isDetailOpen ? 'block' : 'none'
      e.target.textContent = isDetailOpen ? '접기 ▴' : '자세히 보기 ▾'
    }
  }

  // ─── 드래그 및 위치 제어 ──────────────────────────────────────────────────────
  function onMouseMove(e) {
    if (!isDragging || !panel) return
    panel.style.left = e.clientX - offset.x + window.scrollX + 'px'
    panel.style.top = e.clientY - offset.y + window.scrollY + 'px'
  }

  function onMouseUp() {
    isDragging = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  function positionPanel(inputEl) {
    if (!panel || !inputEl || isDragging) return
    const rect = inputEl.getBoundingClientRect()
    const panelWidth = 280
    let left = rect.right + window.scrollX + 12
    let top = rect.top + window.scrollY

    // 화면 우측 경계 체크
    if (left + panelWidth > window.innerWidth + window.scrollX - 12) {
      left = rect.left + window.scrollX - panelWidth - 12
      if (left < 10) {
        left = rect.left + window.scrollX
        top = rect.bottom + window.scrollY + 12
      }
    }
    panel.style.left = left + 'px'
    panel.style.top = top + 'px'
  }

  function toggleMinimize() {
    isMinimized = !isMinimized
    panel.classList.toggle('minimized', isMinimized)
    panel.querySelector('.pwguard-minimize-btn').textContent = isMinimized
      ? '+'
      : '-'
  }

  function hidePanel() {
    if (panel) panel.style.display = 'none'
    isDetailOpen = false
  }

  // ─── 렌더링 엔진 (통합 업데이트) ──────────────────────────────────────────────
  function renderStrength(result) {
    if (!panel) return
    const badge = panel.querySelector('.pwguard-status-badge')
    const scoreText = panel.querySelector('.pwguard-score-text')
    const bar = panel.querySelector('.pwguard-strength-bar')
    const warningList = panel.querySelector('.pwguard-warnings')

    const statusMap = {
      danger: { label: '위험', cls: 'status-danger' },
      normal: { label: '보통', cls: 'status-normal' },
      safe: { label: '안전', cls: 'status-safe' },
    }
    const s = statusMap[result.status] || statusMap.danger

    badge.textContent = s.label
    badge.className = `pwguard-status-badge ${s.cls}`
    scoreText.textContent = `점수: ${result.score}점`
    bar.style.width = Math.min(100, Math.max(0, result.score)) + '%'
    bar.className = `pwguard-strength-bar bar-${result.status}`
    warningList.innerHTML = (result.warnings || [])
      .map((w) => `<li class="pwguard-warning-item">${w}</li>`)
      .join('')
  }

  function renderReuse(reuseResult) {
    if (!panel) return

    // 165라인 오류 방지: buildReuseMessages 결과 안전하게 수신
    const msgs = window.buildReuseMessages
      ? window.buildReuseMessages(reuseResult)
      : { warnings: [], details: [], allSites: [] }
    const { warnings = [], details = [], allSites = [] } = msgs

    const reuseSection = panel.querySelector('.pwguard-reuse-section')
    const reuseWarnList = panel.querySelector('.pwguard-reuse-warnings')
    const reuseDetailList = panel.querySelector('.pwguard-reuse-details')

    if (reuseResult.isReused) {
      reuseSection.style.display = 'block'
      reuseWarnList.innerHTML = warnings
        .filter((w) => !w.includes('일째'))
        .map((w) => `<li>${w}</li>`)
        .join('')

      reuseDetailList.innerHTML = ''
      // 상세 설명 추가
      details.forEach((d) => {
        const li = document.createElement('li')
        li.className = 'pwguard-detail-item'
        li.textContent = d
        reuseDetailList.appendChild(li)
      })

      // 사이트 목록 '더 보기' 토글 로직
      if (allSites && allSites.length > 0) {
        const PREVIEW_LIMIT = 3
        const preview = allSites.slice(0, PREVIEW_LIMIT)
        const extra = allSites.slice(PREVIEW_LIMIT)

        const previewLi = document.createElement('li')
        previewLi.className = 'pwguard-detail-item'
        previewLi.textContent = `사용된 사이트: ${preview.join(', ')}`
        reuseDetailList.appendChild(previewLi)

        if (extra.length > 0) {
          const moreLi = document.createElement('li')
          moreLi.className = 'pwguard-detail-item'
          const moreBtn = document.createElement('button')
          moreBtn.className = 'pwguard-site-more-btn'
          moreBtn.textContent = `외 ${extra.length}개 더 보기 ▾`

          const extraUl = document.createElement('ul')
          extraUl.className = 'pwguard-site-extra-list'
          extraUl.style.display = 'none'
          extra.forEach((s) => {
            const li = document.createElement('li')
            li.textContent = s
            extraUl.appendChild(li)
          })

          moreBtn.onclick = () => {
            const isOpen = extraUl.style.display === 'block'
            extraUl.style.display = isOpen ? 'none' : 'block'
            moreBtn.textContent = isOpen
              ? `외 ${extra.length}개 더 보기 ▾`
              : '접기 ▴'
          }

          moreLi.appendChild(moreBtn)
          moreLi.appendChild(extraUl)
          reuseDetailList.appendChild(moreLi)
        }
      }
      reuseDetailList.style.display = isDetailOpen ? 'block' : 'none'
    } else {
      reuseSection.style.display = 'none'
    }

    // 장기 사용 섹션
    const longSec = panel.querySelector('.pwguard-longuse-section')
    if (reuseResult.isLongUsed) {
      longSec.style.display = 'block'
      panel.querySelector('.pwguard-longuse-warnings').innerHTML = warnings
        .filter((w) => w.includes('일째'))
        .map((w) => `<li>${w}</li>`)
        .join('')
    } else {
      longSec.style.display = 'none'
    }
  }

  // ─── 이벤트 핸들러 ──────────────────────────────────────────────────────────
  function handleInput(e) {
    const input = e.target
    const value = input.value
    const domain = getSiteName()
    positionPanel(input)

    clearTimeout(strengthDebounceTimer)
    strengthDebounceTimer = setTimeout(() => {
      const raw = window.PwAnalyzer?.evaluatePassword(value, {
        siteName: domain,
        reuseCount: 0,
      })
      renderStrength(normalizeAnalyzerResult(raw))
    }, DEBOUNCE_DELAY)

    clearTimeout(reuseDebounceTimer)
    if (value.length >= 4) {
      reuseDebounceTimer = setTimeout(async () => {
        try {
          const reuseResult = await window.analyzeReuse(value, domain)
          renderReuse(reuseResult)
          // 재사용 횟수 반영하여 강도 재계산
          const updatedRaw = window.PwAnalyzer?.evaluatePassword(value, {
            siteName: domain,
            reuseCount: reuseResult.reuseCount,
          })
          renderStrength(normalizeAnalyzerResult(updatedRaw))
        } catch (err) {
          console.warn('[PwGuard] Analysis delay:', err)
        }
      }, REUSE_DELAY)
    }
  }

  function attachEvents(root) {
    const selector = 'input[type="password"]'
    const inputs = root.querySelectorAll ? root.querySelectorAll(selector) : []
    inputs.forEach((input) => {
      if (input.dataset.pwguardAttached) return
      input.dataset.pwguardAttached = 'true'
      input.addEventListener('focus', (e) => {
        activeInput = e.target
        createPanel()
        positionPanel(e.target)
        panel.style.display = 'block'
      })
      input.addEventListener('input', handleInput)
      input.addEventListener('blur', () => {
        setTimeout(() => {
          if (!isDragging && !panel?.contains(document.activeElement))
            hidePanel()
        }, 150)
      })
    })
  }

  // ─── 초기화 ──────────────────────────────────────────────────────────────────
  function init() {
    createPanel()
    attachEvents(document)
    new MutationObserver((m) =>
      m.forEach((r) =>
        r.addedNodes.forEach((n) => {
          if (n.nodeType === 1)
            attachEvents(
              n.matches('input[type="password"]') ? n.parentElement : n,
            )
        }),
      ),
    ).observe(document.body, { childList: true, subtree: true })
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init)
  else init()
})()
