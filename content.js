(function() {
  'use strict';

  const CONFIG = {
    triggerAmount: 500,
    coolingOffPeriod: 10,
    enableCoolingOff: true,
    enableMonthlyBudget: true,
    monthlyBudgetLimit: 5000,
    questions: [
      { question: "Do you really need this item?", type: "yesno" },
      { question: "Have you compared prices elsewhere?", type: "yesno" },
      { question: "Is this a want or a need?", type: "choice", options: ["Need", "Want"] },
      { question: "Will you use this within the next month?", type: "yesno" },
      { question: "What's your reason for buying this?", type: "text" }
    ]
  };

  // State
  let answers = {};
  let cooldownDone = !CONFIG.enableCoolingOff;
  let questionsDone = false;

  // Very light duplicate-add guard (same total within 60s)
  let lastSpendAddedAt = 0;
  let lastSpendAmount = 0;

  function getCurrentMonthKey() {
    // YYYY-MM (UTC). If you want local-time months instead, I can adjust.
    return new Date().toISOString().slice(0, 7);
  }

  function getMonthlySpending() {
    const data = JSON.parse(localStorage.getItem('shopeeGateData') || '{}');
    const currentMonth = getCurrentMonthKey();
    if (data.month !== currentMonth) return 0;
    return Number(data.spending || 0);
  }

  function updateMonthlySpending(amount) {
    const now = Date.now();
    const amt = Number(amount || 0);

    if (!amt || amt <= 0) return;

    // Prevent obvious double-add (same amount clicked twice quickly)
    if (amt === lastSpendAmount && (now - lastSpendAddedAt) < 60_000) {
      console.log('[Gate] Skipped duplicate spend add:', amt);
      return;
    }

    lastSpendAddedAt = now;
    lastSpendAmount = amt;

    const currentMonth = getCurrentMonthKey();
    const newTotal = getMonthlySpending() + amt;
    const data = { month: currentMonth, spending: newTotal };
    localStorage.setItem('shopeeGateData', JSON.stringify(data));
    console.log('[Gate] Monthly spending updated:', data);
  }

  function getCartItems() {
    const allText = document.body && document.body.innerText ? document.body.innerText : '';

    // Try to extract from "Order Total (X items)" or "Total (X items)"
    const itemMatch = allText.match(/(?:Order Total|Total)\s*\((\d+)\s*[Ii]tems?\)/);
    if (itemMatch) {
      const count = parseInt(itemMatch[1], 10);
      if (!Number.isNaN(count) && count > 0) {
        return [{ name: `${count} item${count > 1 ? 's' : ''}`, quantity: count, price: 0 }];
      }
    }

    return [];
  }

  function parsePesoNumber(raw) {
    if (!raw) return 0;
    // Remove commas, keep decimals
    const cleaned = String(raw).replace(/,/g, '');
    const value = parseFloat(cleaned);
    return Number.isFinite(value) ? value : 0;
  }

  function getCartTotal() {
    const text = document.body && document.body.innerText ? document.body.innerText : '';

    // Allow decimals: 1,234.56
    const money = '₱\\s*([\\d,]+(?:\\.\\d{1,2})?)';

    const patterns = [
      new RegExp('Order\\s*Total[\\s\\S]*?' + money, 'i'),
      new RegExp('Total\\s*\\(.*?\\)[\\s\\S]*?:\\s*' + money, 'i'),
      new RegExp('Total\\s*Payment[\\s\\S]*?' + money, 'i'),
      new RegExp('Cart\\s*Total[\\s\\S]*?' + money, 'i'),
      // Fallbacks if the UI label differs:
      new RegExp('\\bTotal\\b[\\s\\S]*?' + money, 'i'),
      new RegExp('\\bPayment\\b[\\s\\S]*?' + money, 'i')
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const value = parsePesoNumber(match[1]);
        if (value > 0) {
          console.log('[Gate] Total:', value, 'Matched:', pattern);
          return value;
        }
      }
    }

    console.log('[Gate] Total: 0 (no match)');
    return 0;
  }

  function createModal(total, items) {
    // reset gating state per modal
    answers = {};
    cooldownDone = !CONFIG.enableCoolingOff;
    questionsDone = false;

    const modal = document.createElement('div');
    modal.id = 'shopeeGateModal';
    modal.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:999999;display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif';

    const content = document.createElement('div');
    content.style.cssText =
      'background:white;padding:30px;border-radius:12px;max-width:600px;width:90%;max-height:85vh;overflow-y:auto;box-shadow:0 10px 40px rgba(0,0,0,0.5)';

    const monthlySpending = getMonthlySpending();
    const budgetRemaining = CONFIG.monthlyBudgetLimit - monthlySpending;
    const wouldExceedBudget = CONFIG.enableMonthlyBudget && (total > budgetRemaining);

    let itemsHTML = '';
    if (items && items.length > 0) {
      itemsHTML =
        '<div style="background:#f8f9fa;padding:15px;border-radius:8px;margin-bottom:20px">' +
          '<p style="margin:0 0 10px 0;font-weight:bold;color:#666;font-size:14px">📦 Items: ' +
            items[0].name +
          '</p>' +
        '</div>';
    }

    content.innerHTML =
      '<h2 style="color:#ee4d2d;margin:0 0 20px 0;font-size:24px">🛑 Hold Up! Think About This Purchase</h2>' +
      itemsHTML +
      '<div style="background:#fff5f5;padding:15px;border-radius:8px;margin-bottom:20px">' +
        '<p style="margin:0;font-size:18px;font-weight:bold">Cart Total: ₱' +
          total.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
        '</p>' +
        (CONFIG.enableMonthlyBudget
          ? '<p style="margin:10px 0 0 0;color:#666">This month: ₱' +
              monthlySpending.toLocaleString('en-PH', { maximumFractionDigits: 2 }) +
              ' / ₱' +
              CONFIG.monthlyBudgetLimit.toLocaleString('en-PH') +
            '</p>' +
            '<p style="margin:5px 0 0 0;color:' +
              (wouldExceedBudget ? '#ff0000' : '#00a650') +
              ';font-weight:bold">' +
              (wouldExceedBudget ? '⚠️ Would exceed budget!' : '✓ Within budget') +
            '</p>'
          : ''
        ) +
      '</div>' +
      '<div id="questionsContainer"></div>' +
      (CONFIG.enableCoolingOff
        ? '<div style="background:#fff3cd;padding:15px;border-radius:8px;margin:20px 0;text-align:center">' +
            '<p style="margin:0;font-weight:bold">⏱️ Cooling Off Period</p>' +
            '<p style="margin:5px 0 0 0;font-size:14px">Wait <span id="countdown">' +
              CONFIG.coolingOffPeriod +
            '</span> seconds</p>' +
          '</div>'
        : ''
      ) +
      '<div style="display:flex;gap:10px;margin-top:20px">' +
        '<button id="gateCancel" style="flex:1;padding:12px;background:#ee4d2d;color:white;border:none;border-radius:6px;font-size:16px;cursor:pointer;font-weight:bold">Cancel</button>' +
        '<button id="gateProceed" disabled style="flex:1;padding:12px;background:#ccc;color:white;border:none;border-radius:6px;font-size:16px;cursor:not-allowed;font-weight:bold">Proceed</button>' +
      '</div>';

    modal.appendChild(content);
    document.body.appendChild(modal);

    renderQuestions();
    if (CONFIG.enableCoolingOff) startCooldown();
    else maybeEnableProceed();

    return modal;
  }

  function renderQuestions() {
    const container = document.getElementById('questionsContainer');
    if (!container) return;

    // IMPORTANT: clear previous content to avoid duplicates
    container.innerHTML = '';
    answers = {};

    CONFIG.questions.forEach((q, index) => {
      const div = document.createElement('div');
      div.style.cssText = 'margin-bottom:20px';

      let inputHTML = '';
      if (q.type === 'yesno') {
        inputHTML =
          '<div style="display:flex;gap:10px;margin-top:10px">' +
            '<button class="gate-answer" data-index="' + index + '" data-value="yes" style="flex:1;padding:10px;background:white;border:2px solid #ddd;border-radius:6px;cursor:pointer">Yes</button>' +
            '<button class="gate-answer" data-index="' + index + '" data-value="no" style="flex:1;padding:10px;background:white;border:2px solid #ddd;border-radius:6px;cursor:pointer">No</button>' +
          '</div>';
      } else if (q.type === 'choice') {
        inputHTML =
          '<div style="display:flex;gap:10px;margin-top:10px">' +
            q.options.map(opt =>
              '<button class="gate-answer" data-index="' + index + '" data-value="' + opt + '" style="flex:1;padding:10px;background:white;border:2px solid #ddd;border-radius:6px;cursor:pointer">' +
                opt +
              '</button>'
            ).join('') +
          '</div>';
      } else if (q.type === 'text') {
        inputHTML =
          '<textarea class="gate-answer-text" data-index="' + index + '" placeholder="Type your answer..." style="width:100%;padding:10px;margin-top:10px;border:2px solid #ddd;border-radius:6px;min-height:60px;box-sizing:border-box"></textarea>';
      }

      div.innerHTML =
        '<p style="margin:0;font-weight:bold;color:#333">' +
          (index + 1) + '. ' + q.question +
        '</p>' +
        inputHTML;

      container.appendChild(div);
    });

    document.querySelectorAll('.gate-answer').forEach(btn => {
      btn.addEventListener('click', function() {
        const index = this.dataset.index;
        const value = this.dataset.value;

        // Reset styling within this question group
        const group = this.parentElement;
        if (group) {
          group.querySelectorAll('.gate-answer').forEach(b => {
            b.style.background = 'white';
            b.style.borderColor = '#ddd';
          });
        }

        this.style.background = '#e8f5e9';
        this.style.borderColor = '#4caf50';

        answers[index] = value;
        checkAllAnswered();
      });
    });

    document.querySelectorAll('.gate-answer-text').forEach(textarea => {
      textarea.addEventListener('input', function() {
        answers[this.dataset.index] = this.value.trim();
        checkAllAnswered();
      });
    });
  }

  function checkAllAnswered() {
    const answeredCount = Object.keys(answers).filter(key => answers[key]).length;
    questionsDone = answeredCount >= CONFIG.questions.length;
    maybeEnableProceed();
  }

  function startCooldown() {
    let time = CONFIG.coolingOffPeriod;
    const interval = setInterval(() => {
      time--;
      const el = document.getElementById('countdown');
      if (el) el.textContent = String(Math.max(0, time));
      if (time <= 0) {
        clearInterval(interval);
        cooldownDone = true;
        maybeEnableProceed();
      }
    }, 1000);
  }

  function maybeEnableProceed() {
    // Require BOTH: questions + cooldown
    if (questionsDone && cooldownDone) enableProceedButton();
  }

  function enableProceedButton() {
    const btn = document.getElementById('gateProceed');
    if (btn && btn.disabled) {
      btn.disabled = false;
      btn.style.background = '#00a650';
      btn.style.cursor = 'pointer';
    }
  }

  function isLikelyCheckoutButton(button) {
    const text = (button.textContent || '').trim().toLowerCase();

    // More tolerant matching
    const matchesCheckout =
      (text.includes('check') && text.includes('out')) ||
      text.includes('place order') ||
      text.includes('buy now');

    return matchesCheckout;
  }

  function interceptCheckout() {
    const buttons = document.querySelectorAll('button');
    buttons.forEach(button => {
      if (button.dataset.gateAttached) return;
      if (!isLikelyCheckoutButton(button)) return;

      console.log('[Gate] Attached to:', (button.textContent || '').trim());
      button.dataset.gateAttached = 'true';

      button.addEventListener('click', function(e) {
        // Allow the second click to pass through (same element instance only)
        if (this.dataset.gateApproved) {
          delete this.dataset.gateApproved;
          return;
        }

        const total = getCartTotal();
        if (total >= CONFIG.triggerAmount) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();

          console.log('[Gate] INTERCEPTED! Total:', total);

          const items = getCartItems();
          const modal = createModal(total, items);

          const cancelBtn = document.getElementById('gateCancel');
          const proceedBtn = document.getElementById('gateProceed');

          if (cancelBtn) cancelBtn.onclick = () => modal.remove();

          if (proceedBtn) {
            proceedBtn.onclick = () => {
              // Only proceed if enabled (defensive)
              if (proceedBtn.disabled) return;

              updateMonthlySpending(total);
              modal.remove();

              this.dataset.gateApproved = 'true';
              this.click();
            };
          }
        }
      }, true);
    });
  }

  // Start
  interceptCheckout();

  // Keep scanning in case Shopee renders buttons after load
  setInterval(interceptCheckout, 2000);

  console.log('[Shopee Gate] Active! Threshold: ₱' + CONFIG.triggerAmount);
})();
