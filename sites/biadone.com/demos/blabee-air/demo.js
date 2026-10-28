(() => {
  'use strict';

  const product = document.querySelector('[data-product-demo]');

  if (product) {
    const summary = product.querySelector('[data-demo-summary]');
    const status = product.querySelector('[data-demo-status]');
    const feedback = product.querySelector('[data-demo-feedback]');
    const reset = product.querySelector('[data-demo-reset]');
    const documentStatus = document.querySelector('[data-document-status]');
    const choices = [...product.querySelectorAll('[data-choice]')];

    if (summary && status && feedback && reset && choices.length) {
      const initial = {
        summary: summary.textContent,
        status: status.textContent,
        feedback: feedback.textContent,
        documentStatus: documentStatus?.textContent,
      };
      let pending = null;
      const choiceLabels = {
        1: 'Preview the page',
        2: 'Review the changes',
        3: 'Check mobile layout',
        4: 'Plan the next step',
      };

      const cancelPending = () => {
        if (pending !== null) {
          window.clearTimeout(pending);
          pending = null;
        }
      };

      const selectChoice = (choice) => {
        cancelPending();
        const label = choiceLabels[choice.dataset.choice] || choice.textContent.trim();

        for (const button of choices) {
          const selected = button === choice;
          button.classList.toggle('is-selected', selected);
          button.setAttribute('aria-pressed', String(selected));
        }

        product.dataset.demoState = 'continuing';
        summary.textContent = 'Your next step, in the same conversation.';
        status.textContent = 'Continuing…';
        feedback.textContent = 'Demo only: sending your choice to the same Codex conversation.';
        if (documentStatus) documentStatus.textContent = 'Codex · Continuing the same conversation…';

        const complete = () => {
          pending = null;
          product.dataset.demoState = 'complete';
          summary.textContent = label;
          status.textContent = 'Next step ready';
          feedback.textContent = `“${label}” continues in the same Codex conversation. Demo only; no real task ran.`;
          if (documentStatus) documentStatus.textContent = 'Codex · Same conversation, next step ready';
        };

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          complete();
        } else {
          pending = window.setTimeout(complete, 520);
        }
      };

      for (const choice of choices) {
        choice.addEventListener('click', (event) => {
          event.preventDefault();
          selectChoice(choice);
        });
      }

      reset.addEventListener('click', (event) => {
        event.preventDefault();
        cancelPending();
        delete product.dataset.demoState;
        for (const button of choices) {
          button.classList.remove('is-selected');
          button.setAttribute('aria-pressed', 'false');
        }
        summary.textContent = initial.summary;
        status.textContent = initial.status;
        feedback.textContent = initial.feedback;
        if (documentStatus) documentStatus.textContent = initial.documentStatus;
      });

      product.addEventListener('keydown', (event) => {
        if (!event.altKey || event.metaKey || event.ctrlKey || event.repeat) return;
        if (!product.contains(document.activeElement)) return;
        const target = event.target;
        if (target instanceof Element && (
          target.closest('input, textarea, select') || target.isContentEditable
        )) return;
        const key = /^Digit([1-4])$/.exec(event.code);
        if (!key) return;
        const choice = choices.find((button) => button.dataset.choice === key[1]);
        if (!choice || choice.disabled) return;
        event.preventDefault();
        selectChoice(choice);
      });
    }
  }

  const form = document.querySelector('[data-beta-form]');
  const email = form?.querySelector('[data-email]');
  const submit = form?.querySelector('[data-form-submit]');
  const feedback = document.querySelector('[data-form-feedback]');
  const reset = document.querySelector('[data-form-reset]');

  if (form && email && submit && feedback && reset) {
    const submitChildren = [...submit.childNodes].map((node) => node.cloneNode(true));

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (form.dataset.previewComplete === 'true' || !form.reportValidity()) return;

      // This preview never sends or retains the entered address.
      email.value = '';
      email.disabled = true;
      submit.disabled = true;
      submit.textContent = 'Preview complete';
      form.dataset.previewComplete = 'true';
      feedback.textContent = 'Preview complete. No beta request was sent and your email was not saved.';
      reset.hidden = false;
    });

    reset.addEventListener('click', (event) => {
      event.preventDefault();
      email.value = '';
      email.disabled = false;
      submit.disabled = false;
      submit.replaceChildren(...submitChildren.map((node) => node.cloneNode(true)));
      delete form.dataset.previewComplete;
      feedback.textContent = '';
      reset.hidden = true;
      email.focus();
    });

    // Enable entry only after the local-only submit handler is installed.
    email.disabled = false;
    submit.disabled = false;
  }

  const video = document.querySelector('[data-real-video]');
  const videoError = document.querySelector('[data-video-error]');
  if (video && videoError) {
    const showVideoError = () => { videoError.hidden = false; };
    video.addEventListener('error', showVideoError);
    for (const source of video.querySelectorAll('source')) {
      source.addEventListener('error', showVideoError);
    }
    if (video.error) showVideoError();
  }
})();
