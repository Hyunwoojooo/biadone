(() => {
  'use strict';

  const content = window.BIADONE_EDU_CONTENT || {};
  const email = 'biadone.official@gmail.com';
  const text = value => typeof value === 'string' ? value.trim() : '';
  const items = value => Array.isArray(value) ? value : [];
  const strings = value => items(value).map(text).filter(Boolean);
  const byId = id => document.getElementById(id);

  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value) node.textContent = value;
    return node;
  }

  function linkURL(value) {
    const raw = text(value);
    if (!raw || raw.startsWith('#') || raw.startsWith('//')) return null;
    try {
      const url = new URL(raw, location.href);
      if (url.protocol === 'https:' || (url.origin === location.origin && url.protocol === location.protocol)) {
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        return url.href;
      }
    } catch { /* A missing or invalid route is not an application path. */ }
    return null;
  }

  function assetURL(value) {
    const url = linkURL(value);
    if (!url) return null;
    const parsed = new URL(url);
    return parsed.origin === location.origin && parsed.pathname.startsWith('/assets/') ? url : null;
  }

  function mediaElement(media, eager = false) {
    if (!media || !['image', 'video'].includes(media.type)) return null;
    const src = assetURL(media.src);
    if (!src || !text(media.alt)) return null;
    if (media.type === 'video') {
      const video = element('video');
      video.src = src;
      video.controls = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.setAttribute('aria-label', text(media.alt));
      const poster = assetURL(media.poster);
      if (poster) video.poster = poster;
      return video;
    }
    const image = element('img');
    image.src = src;
    image.alt = text(media.alt);
    image.loading = eager ? 'eager' : 'lazy';
    image.decoding = 'async';
    return image;
  }

  function appendMedia(container, media, eager = false) {
    const node = mediaElement(media, eager);
    if (!node) return false;
    container.appendChild(node);
    if (text(media.caption)) container.appendChild(element('figcaption', '', text(media.caption)));
    return true;
  }

  function addTextList(container, heading, values, className) {
    const list = strings(values);
    if (!list.length) return;
    const group = element('div', className);
    group.appendChild(element('h4', '', heading));
    const ul = element('ul');
    list.forEach(value => ul.appendChild(element('li', '', value)));
    group.appendChild(ul);
    container.appendChild(group);
  }

  function renderHeroMedia() {
    const media = content.heroMedia;
    const target = byId('hero-media');
    if (!target || !media || media.approved !== true || !mediaElement(media)) return;
    target.replaceChildren();
    appendMedia(target, media, true);
    target.hidden = false;
    if (byId('hero-method')) byId('hero-method').hidden = true;
  }

  function renderCases() {
    const list = byId('cases-list');
    const section = byId('published-cases');
    if (!list || !section) return;
    const cases = items(content.publishedCases).filter(entry => {
      if (!entry || entry.published !== true || entry.approved !== true || !text(entry.title) ||
        !strings(entry.materials).length || !text(entry.result) || !text(entry.humanReview) ||
        !text(entry.learning) || !mediaElement(entry.media)) return false;
      if (entry.evidenceType === 'public-page') return Boolean(text(entry.purpose) && linkURL(entry.url));
      return Boolean(text(entry.problem) && strings(entry.work).length);
    });
    if (!cases.length) return;
    cases.forEach((entry, index) => {
      const article = element('article', 'case-story');
      const copy = element('div', 'case-copy');
      const title = element('h3', 'case-title', text(entry.title));
      title.id = 'case-title-' + index;
      article.setAttribute('aria-labelledby', title.id);
      const header = element('div', 'case-header');
      header.appendChild(title);
      copy.appendChild(header);
      const summary = element('div', 'case-summary');
      text(entry.result).split(/\n\s*\n/).forEach(paragraph => summary.appendChild(element('p', '', paragraph)));
      copy.appendChild(summary);
      const learning = element('p', 'case-learning');
      learning.append(element('strong', '', '이 사례에서 배우는 것'), element('span', '', text(entry.learning)));
      copy.appendChild(learning);
      const url = linkURL(entry.url);
      if (url) {
        const link = element('a', 'text-action case-link', '결과물 보기 →');
        link.href = url;
        if (new URL(url).origin !== location.origin) {
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.setAttribute('aria-label', text(entry.title) + ' 실제 페이지 보기 (새 창)');
        }
        copy.appendChild(link);
      }
      article.appendChild(copy);
      const media = element('figure', 'case-media');
      appendMedia(media, entry.media);
      article.appendChild(media);
      const facts = element('dl', 'case-facts');
      const publicPage = entry.evidenceType === 'public-page';
      [
        [publicPage ? '페이지의 목적' : '원래의 문제', text(publicPage ? entry.purpose : entry.problem)],
        [publicPage ? '페이지에 담긴 자료' : '사용한 자료', strings(entry.materials)],
        ['AI와 한 작업', strings(entry.work)],
        [publicPage ? '운영자가 확인할 점' : '사람의 확인·수정', text(entry.humanReview)]
      ].forEach(([label, value]) => {
        if (Array.isArray(value) ? !value.length : !value) return;
        const row = element('div');
        const detail = element('dd');
        if (Array.isArray(value)) {
          const ul = element('ul');
          value.forEach(item => ul.appendChild(element('li', '', item)));
          detail.appendChild(ul);
        } else detail.textContent = value;
        row.append(element('dt', '', label), detail);
        facts.appendChild(row);
      });
      const details = element('details', 'case-details');
      details.append(element('summary', '', '사례 자세히 보기'), facts);
      if (text(entry.evidenceNote)) details.appendChild(element('p', 'case-evidence-note', text(entry.evidenceNote)));
      if (entry.showDetails !== false) article.appendChild(details);
      list.appendChild(article);
    });
    section.hidden = false;
    if (byId('cases-alternatives')) byId('cases-alternatives').hidden = false;
    document.querySelectorAll('[data-cases-link]').forEach(link => {
      link.textContent = link.dataset.casesLink === 'hero' ? '실제 활용 사례 보기' : '실제 활용 사례';
    });
  }

  function renderCourses() {
    const target = byId('courses-list');
    if (!target) return;
    let available = 0;
    items(content.courses).filter(course => course && text(course.category)).forEach((course, index) => {
      const applicationURL = linkURL(course.application?.url);
      const open = course.status === 'open' && Boolean(applicationURL);
      if (open) available += 1;
      const statuses = { preparing: '준비 중', announced: '모집 예정', closed: '모집 마감' };
      const status = open ? '신청 가능' : statuses[course.status] || '준비 중';
      const article = element('article', 'course');
      const meta = element('div', 'course-meta');
      meta.append(element('span', 'course-index', String(index + 1).padStart(2, '0')), element('span', 'course-state', status));
      article.appendChild(meta);
      if (text(course.title)) article.appendChild(element('p', 'course-category', text(course.category)));
      article.appendChild(element('h3', 'course-title', text(course.title) || text(course.category)));
      if (text(course.description)) article.appendChild(element('p', 'course-description', text(course.description)));
      const details = element('details', 'course-details');
      details.appendChild(element('summary', '', '과정 자세히 보기'));
      const detailContent = element('div', 'course-detail-content');
      addTextList(detailContent, '이런 분께 맞습니다', course.audience, 'course-audience');
      const curriculum = items(course.curriculum).filter(item => text(typeof item === 'string' ? item : item?.title));
      if (curriculum.length) {
        const group = element('div', 'course-curriculum');
        group.appendChild(element('h4', '', '배우는 내용'));
        const ol = element('ol');
        curriculum.forEach(item => {
          const li = element('li');
          li.appendChild(element('strong', '', text(typeof item === 'string' ? item : item.title)));
          if (typeof item !== 'string' && text(item.description)) li.appendChild(element('p', '', text(item.description)));
          ol.appendChild(li);
        });
        group.appendChild(ol);
        detailContent.appendChild(group);
      }
      addTextList(detailContent, '실습 자료', course.materials, 'course-materials');
      addTextList(detailContent, '수강 후 할 수 있는 일', course.outcomes, 'course-outcomes');
      const facts = element('dl', 'course-facts');
      [
        ['진행 방식', course.format], ['시간·기간', course.duration], ['일정', course.schedule],
        ['장소', course.location], ['가격', course.price], ['질문·지원', course.support]
      ].forEach(([label, value]) => {
        if (!text(value)) return;
        const row = element('div');
        row.append(element('dt', '', label), element('dd', '', text(value)));
        facts.appendChild(row);
      });
      if (facts.childElementCount) detailContent.appendChild(facts);
      if (detailContent.childElementCount) {
        details.appendChild(detailContent);
        article.appendChild(details);
      }
      if (open) {
        const link = element('a', 'button course-application', text(course.application.label) || '과정 신청하기');
        link.href = applicationURL;
        article.appendChild(link);
      }
      target.appendChild(article);
    });
    const note = byId('courses-note');
    if (note && available) note.textContent = '과정별 대상과 진행 방식, 신청 정보를 확인하고 지금 필요한 단계에서 시작하세요.';
    else if (note && items(content.courses).some(course => ['announced', 'closed'].includes(course?.status))) {
      note.textContent = '과정별 상세 안내와 현재 신청 상태를 확인해 주세요.';
    }
  }

  function renderCurriculum() {
    const plan = content.curriculumPlan;
    const section = byId('curriculum');
    const target = byId('curriculum-tracks');
    if (!section || !target || plan?.published !== true) return;
    const tracks = items(plan.tracks).map(track => ({
      title: text(track?.title),
      modules: items(track?.modules).filter(module => text(module?.title) && strings(module?.items).length)
    })).filter(track => track.title && track.modules.length);
    if (!tracks.length) return;
    if (byId('curriculum-title') && text(plan.title)) byId('curriculum-title').textContent = text(plan.title);
    if (byId('curriculum-summary')) byId('curriculum-summary').textContent = text(plan.summary);
    tracks.forEach((track, index) => {
      const panel = element('article', 'curriculum-track');
      const titleId = 'curriculum-track-' + index;
      panel.setAttribute('aria-labelledby', titleId);
      const bar = element('div', 'curriculum-track-bar');
      const title = element('h3', '', track.title);
      title.id = titleId;
      bar.append(title, element('span', 'curriculum-track-count', track.modules.length + '개 영역'));
      panel.appendChild(bar);
      track.modules.forEach(module => {
        const group = element('section', 'curriculum-module');
        if (text(module.id)) group.dataset.moduleId = text(module.id);
        if (text(module.group)) group.appendChild(element('p', 'curriculum-module-tag', text(module.group)));
        const head = element('div', 'curriculum-module-head');
        head.appendChild(element('h4', '', text(module.title)));
        if (text(module.duration)) head.appendChild(element('p', 'curriculum-duration', text(module.duration)));
        group.appendChild(head);
        if (text(module.output)) {
          const output = element('p', 'curriculum-output');
          output.append(element('span', '', '완성하는 결과물'), element('strong', '', text(module.output)));
          group.appendChild(output);
        }
        const list = element('ul', 'curriculum-items');
        strings(module.items).forEach(value => list.appendChild(element('li', '', value)));
        group.appendChild(list);
        panel.appendChild(group);
      });
      target.appendChild(panel);
    });
    const notes = byId('curriculum-notes');
    if (notes) strings(plan.notes).forEach(note => notes.appendChild(element('p', '', '※ ' + note)));
    section.hidden = false;
    if (byId('curriculum-jump')) byId('curriculum-jump').hidden = false;
  }

  function renderGallery() {
    const gallery = content.offlineGallery || {};
    const section = byId('offline-gallery');
    const target = byId('offline-gallery-list');
    if (!section || !target) return;
    [gallery.cover, gallery.practice, gallery.feedback, ...items(gallery.additional)].forEach(photo => {
      if (!photo || photo.approved !== true || !text(photo.alt) || !assetURL(photo.src)) return;
      const figure = element('figure', 'gallery-item');
      appendMedia(figure, { ...photo, type: 'image' });
      target.appendChild(figure);
    });
    section.hidden = target.childElementCount === 0;
  }

  function renderExperience() {
    const experience = content.introExperience;
    const section = byId('intro-experience');
    const target = byId('intro-experience-content');
    if (!section || !target || experience?.status !== 'ready' || !text(experience.title)) return;
    const steps = items(experience.steps).filter(step => text(typeof step === 'string' ? step : step?.title));
    const url = linkURL(experience.application?.url);
    if (!text(experience.description) && !steps.length && !url) return;
    target.appendChild(element('h2', 'section-heading', text(experience.title)));
    if (text(experience.description)) target.appendChild(element('p', 'section-copy', text(experience.description)));
    if (steps.length) {
      const list = element('ol', 'experience-steps');
      steps.forEach(step => {
        const item = element('li');
        item.appendChild(element('h3', '', text(typeof step === 'string' ? step : step.title)));
        if (typeof step !== 'string' && text(step.description)) item.appendChild(element('p', '', text(step.description)));
        list.appendChild(item);
      });
      target.appendChild(list);
    }
    if (url) {
      const link = element('a', 'button', text(experience.application.label) || '입문·체험 시작하기');
      link.href = url;
      target.appendChild(link);
    }
    section.hidden = false;
  }

  function renderFAQs() {
    const target = byId('faq-list');
    if (!target) return;
    items(content.faqs).filter(faq => faq && faq.published === true && text(faq.question) && text(faq.answer)).forEach(faq => {
      const detail = element('details', 'faq-item');
      detail.append(element('summary', '', text(faq.question)), element('p', '', text(faq.answer)));
      target.appendChild(detail);
    });
    if (!target.childElementCount && byId('faq')) byId('faq').hidden = true;
  }

  renderHeroMedia();
  renderCases();
  renderCourses();
  renderCurriculum();
  renderGallery();
  renderExperience();
  renderFAQs();

  const menuToggle = document.querySelector('[data-menu-toggle]');
  const nav = byId('main-nav');
  function setMenu(open) {
    if (!menuToggle || !nav) return;
    menuToggle.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('open', open);
    const icon = menuToggle.querySelector('span');
    if (icon) icon.textContent = open ? '−' : '＋';
  }
  menuToggle?.addEventListener('click', () => setMenu(menuToggle.getAttribute('aria-expanded') !== 'true'));
  nav?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menuToggle?.getAttribute('aria-expanded') === 'true') {
      setMenu(false);
      menuToggle.focus();
    }
  });

  function downloadText(filename, value) {
    const url = URL.createObjectURL(new Blob(['\ufeff', value], { type: 'text/plain;charset=utf-8' }));
    const link = element('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const dialog = byId('consult-dialog');
  const form = byId('consult-form');
  const formStatus = byId('form-status');
  const service = byId('consult-service');
  let lastOpener = null;
  function isCustomInquiry() { return service?.value === '맞춤 제작 + 활용교육'; }
  function setInquiryMode() {
    const custom = isCustomInquiry();
    const institution = byId('institution-fields');
    const customFields = byId('custom-fields');
    if (institution) { institution.hidden = custom; institution.disabled = custom; }
    if (customFields) { customFields.hidden = !custom; customFields.disabled = !custom; }
    byId('consult-title').textContent = custom ? '맞춤 제작 + 활용교육 문의' : service.value + ' 문의';
    const updateLabel = (id, value) => {
      const label = byId(id);
      label.replaceChildren(document.createTextNode(value + ' '), element('span', 'required', '필수'));
    };
    updateLabel('consult-name-label', custom ? '성함 / 회사명' : '담당자 이름');
    updateLabel('consult-brief-label', custom ? '현재 업무와 필요한 결과' : '교육 주제와 원하는 결과');
    formStatus.textContent = '';
  }
  service?.addEventListener('change', setInquiryMode);
  if (service) setInquiryMode();
  document.querySelectorAll('[data-inquiry-open]').forEach(button => {
    button.addEventListener('click', () => {
      if (!dialog || !service) return;
      lastOpener = button;
      service.value = button.dataset.inquiryOpen === 'custom' ? '맞춤 제작 + 활용교육' : '기관·단체 교육';
      setInquiryMode();
      setMenu(false);
      dialog.showModal();
      document.body.classList.add('dialog-open');
    });
  });
  document.querySelectorAll('[data-consult-close]').forEach(button => button.addEventListener('click', () => dialog?.close()));
  dialog?.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog?.addEventListener('close', () => {
    document.body.classList.remove('dialog-open');
    lastOpener?.focus({ preventScroll: true });
  });

  function inquiryText() {
    const values = new FormData(form);
    const name = values.get('name') || '(미입력)';
    const address = values.get('email') || '(미입력)';
    let body = `[Biadone EDU 문의]\n\n문의 유형: ${values.get('service')}\n${isCustomInquiry() ? '성함 / 회사명' : '담당자 이름'}: ${name}\n답변받을 이메일: ${address}\n`;
    if (!isCustomInquiry()) body += `기관명: ${values.get('org') || '(미입력)'}\n교육 대상: ${values.get('audience') || '(미입력)'}\n예상 인원: ${values.get('participants') || '미정'}\n`;
    body += `\n${isCustomInquiry() ? '현재 업무와 필요한 결과' : '교육 주제와 원하는 결과'}\n${values.get('message') || '(미입력)'}\n\n희망 일정: ${values.get('timeline') || '미정'}\n`;
    if (isCustomInquiry()) body += `예산: ${values.get('budget') || '미정'}\n`;
    return body;
  }
  async function copyText(value, successMessage) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      formStatus.textContent = successMessage;
    } catch {
      const previousFocus = document.activeElement;
      const field = element('textarea');
      field.value = value;
      field.style.position = 'fixed';
      field.style.left = '-9999px';
      dialog.appendChild(field);
      field.select();
      let copied = false;
      try { copied = document.execCommand('copy'); } catch { /* Keep the file download alternative available. */ }
      field.remove();
      previousFocus?.focus({ preventScroll: true });
      formStatus.textContent = copied ? successMessage : '복사가 지원되지 않습니다. 문의 내용 저장을 이용해 주세요.';
    }
  }
  document.querySelectorAll('[data-copy-email]').forEach(button => button.addEventListener('click', () => copyText(email, '이메일 주소를 복사했습니다.')));
  byId('copy-inquiry')?.addEventListener('click', () => copyText(inquiryText(), '문의 내용을 복사했습니다.'));
  byId('download-inquiry')?.addEventListener('click', () => {
    downloadText(isCustomInquiry() ? 'Biadone-제작상담.txt' : 'Biadone-기관교육문의.txt', inquiryText());
    formStatus.textContent = '문의 내용을 파일로 저장했습니다.';
  });
  form?.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const subject = `[Biadone EDU 문의] ${service.value} — ${form.elements.name.value.trim()}`;
    const link = element('a');
    link.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(inquiryText())}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    formStatus.textContent = '메일 앱에서 전송을 완료해 주세요. 앱이 열리지 않으면 문의 내용을 복사해 biadone.official@gmail.com으로 보내주세요.';
  });
  if (byId('year')) byId('year').textContent = new Date().getFullYear();
})();
