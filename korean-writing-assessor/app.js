// ==========================================================================
// Vibe Project Hub - Client Logic Script
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  // 1. Core State
  let projects = [];
  let currentFilterStatus = 'all';
  let currentSearchQuery = '';

  // 2. DOM Elements
  const projectsGrid = document.getElementById('projects-grid');
  const searchInput = document.getElementById('search-input');
  const filterButtons = document.querySelectorAll('.filter-btn');
  const btnOpenModal = document.getElementById('btn-open-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const btnCancelModal = document.getElementById('btn-cancel-modal');
  const projectModal = document.getElementById('project-modal');
  const projectForm = document.getElementById('project-form');
  
  // Stats Elements
  const statTotal = document.getElementById('stat-total');
  const statCompleted = document.getElementById('stat-completed');
  const statProgress = document.getElementById('stat-progress');

  // Footer Actions
  const btnCopyJson = document.getElementById('btn-copy-json');
  const btnDownloadJson = document.getElementById('btn-download-json');
  const toast = document.getElementById('toast');

  // New Interactive Elements
  const projTechInput = document.getElementById('proj-tech');
  const btnAnalyzeDemo = document.getElementById('btn-analyze-demo');
  const btnAnalyzeRepo = document.getElementById('btn-analyze-repo');
  const stackChips = document.querySelectorAll('.stack-chip');

  // Google Sheets Sync Settings Elements
  const syncIndicator = document.getElementById('sync-indicator');
  const btnOpenSettings = document.getElementById('btn-open-settings');
  const btnCloseSettings = document.getElementById('btn-close-settings');
  const btnCancelSettings = document.getElementById('btn-cancel-settings');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const btnClearSettings = document.getElementById('btn-clear-settings');
  const settingsModal = document.getElementById('settings-modal');
  const settingsApiUrlInput = document.getElementById('settings-api-url');

  const DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbwwpi_1lsya4u535-My2j4kXnegUhmxmlX6rtkdEOxyvvTOxYGODwno-TWYi1wJ4LAMpg/exec';

  // Get active Sheet API URL (Local Storage preference OR Default hardcoded GAS Web App URL)
  function getSheetApiUrl() {
    const saved = localStorage.getItem('sheet_api_url');
    if (saved === 'none') {
      return null; // Explicitly disabled
    }
    if (!saved) {
      return DEFAULT_API_URL; // Fallback default
    }
    return saved; // User custom URL
  }

  // 3. Init Function
  async function init() {
    // Initialize Lucide icons on page load
    lucide.createIcons();
    
    updateSyncIndicator();

    const sheetApiUrl = getSheetApiUrl();
    if (sheetApiUrl) {
      await fetchFromGoogleSheets(sheetApiUrl);
    } else {
      // Offline/Local mode loading
      const savedData = localStorage.getItem('vibe_projects');
      if (savedData) {
        try {
          projects = JSON.parse(savedData);
          render();
        } catch (e) {
          console.error('Failed to parse saved projects', e);
          await fetchProjectsFromJson();
        }
      } else {
        await fetchProjectsFromJson();
      }
    }

    setupEventListeners();
  }

  // Update visual state of Sheets Integration Indicator
  function updateSyncIndicator() {
    const sheetApiUrl = getSheetApiUrl();
    if (sheetApiUrl) {
      syncIndicator.className = 'sync-indicator api-mode';
      syncIndicator.querySelector('.indicator-text').textContent = 'Google Sheets 동기화 중';
    } else {
      syncIndicator.className = 'sync-indicator local-mode';
      syncIndicator.querySelector('.indicator-text').textContent = '로컬 단독 모드';
    }
  }

  // Fetch live projects from Google Sheets via Web App API
  async function fetchFromGoogleSheets(apiUrl) {
    projectsGrid.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Google Sheets에서 데이터 동기화 중...</p>
      </div>
    `;
    lucide.createIcons();

    try {
      // Prevent browser cache on GET requests
      const cacheBustUrl = apiUrl + (apiUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
      const response = await fetch(cacheBustUrl);
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
          projects = data;
          saveToLocalStorage(); // Cache it locally
          render();
        } else {
          console.error('GAS response is not array', data);
          showToast('동기화 실패: 데이터 형식이 잘못되었습니다.');
          loadLocalFallback();
        }
      } else {
        showToast('구글 시트 로드 실패. 로컬 캐시를 불러옵니다.');
        loadLocalFallback();
      }
    } catch (err) {
      console.error('Sheets sync error:', err);
      showToast('네트워크 오류: 로컬 오프라인 데이터로 구동합니다.');
      loadLocalFallback();
    }
  }

  // Local fallback runner if Sheets fetch fails
  function loadLocalFallback() {
    const savedData = localStorage.getItem('vibe_projects');
    if (savedData) {
      try {
        projects = JSON.parse(savedData);
        render();
      } catch (e) {
        fetchProjectsFromJson();
      }
    } else {
      fetchProjectsFromJson();
    }
  }

  // Fetch initial config from JSON file
  async function fetchProjectsFromJson() {
    try {
      const response = await fetch('projects.json');
      if (response.ok) {
        projects = await response.json();
        saveToLocalStorage();
        render();
      } else {
        loadFallbackData();
      }
    } catch (err) {
      console.warn('Fetch failed (CORS or server error). Using fallback embedded data.', err);
      loadFallbackData();
    }
  }

  // Fallback default data for offline/local run without server
  function loadFallbackData() {
    projects = [
      {
        "id": 1,
        "title": "Gemini Antigravity Extension",
        "description": "AI 에이전트를 로컬 개발 환경과 연결하여 실시간 코딩 및 리서치를 보조하는 강력한 Chrome 확장 프로그램입니다.",
        "status": "completed",
        "category": "Chrome Extension",
        "techStack": ["JavaScript", "HTML", "Chrome API", "CSS"],
        "aiTools": "Gemini 3.5 Flash",
        "promptSummary": "Chrome 확장 프로그램의 백그라운드 스크립트와 사이드패널 간 양방향 메시지 통신을 구현하고, 예외 처리가 가미된 표준 보일러플레이트 코드를 작성해줘.",
        "demoUrl": "https://example.com/demo-antigravity",
        "repoUrl": "https://github.com/user/gemini-antigravity",
        "createdAt": "2026-07-10"
      },
      {
        "id": 2,
        "title": "AI Email Autowriter",
        "description": "수신된 이메일의 맥락과 톤앤매너를 분석하여 상황별 맞춤 답장 초안을 원클릭으로 작성해주는 PyQt6 데스크톱 프로그램입니다.",
        "status": "in-progress",
        "category": "Desktop App",
        "techStack": ["Python", "PyQt6", "Gemini API"],
        "aiTools": "Claude 3.5 Sonnet",
        "promptSummary": "PyQt6 환경에서 QThread와 Worker 패턴을 사용해 백그라운드에서 API 요청을 처리하고, UI가 멈추지 않는 로딩 스피너 애니메이션을 구현해줘.",
        "demoUrl": "",
        "repoUrl": "https://github.com/user/email-autowriter",
        "createdAt": "2026-07-11"
      },
      {
        "id": 3,
        "title": "Smart Scheduler Bot",
        "description": "대화형 자연어 메신저 대화 속에서 날짜, 시간, 약속 내용을 추출해 캘린더 일정을 자동 스케줄링해주는 Discord 봇입니다.",
        "status": "idea",
        "category": "Bot / CLI",
        "techStack": ["Node.js", "Discord.js", "Google Calendar API"],
        "aiTools": "GPT-4o",
        "promptSummary": "자연어 문장(예: 내일 오후 3시에 철수와 미팅 있어)에서 날짜, 시간, 제목을 정확하게 ISO8601 포맷의 JSON으로 매핑해주는 OpenAI 시스템 프롬프트를 설계해줘.",
        "demoUrl": "",
        "repoUrl": "",
        "createdAt": "2026-07-12"
      }
    ];
    saveToLocalStorage();
    render();
  }

  // Save changes to localStorage
  function saveToLocalStorage() {
    localStorage.setItem('vibe_projects', JSON.stringify(projects, null, 2));
  }

  // 4. Render Layout & Cards
  function render() {
    updateStats();

    // Filter projects
    const filteredProjects = projects.filter(project => {
      const matchesStatus = currentFilterStatus === 'all' || project.status === currentFilterStatus;
      
      const query = currentSearchQuery.toLowerCase().trim();
      const matchesSearch = !query || 
        project.title.toLowerCase().includes(query) ||
        project.description.toLowerCase().includes(query) ||
        project.techStack.some(tech => tech.toLowerCase().includes(query)) ||
        (project.aiTools && project.aiTools.toLowerCase().includes(query));

      return matchesStatus && matchesSearch;
    });

    // Empty state check
    if (filteredProjects.length === 0) {
      projectsGrid.innerHTML = `
        <div class="empty-state">
          <i data-lucide="folder-open" style="width: 48px; height: 48px; color: var(--text-muted);"></i>
          <p>일치하는 프로젝트가 없습니다.</p>
        </div>
      `;
      lucide.createIcons();
      return;
    }

    // Map projects to HTML cards
    projectsGrid.innerHTML = filteredProjects.map(project => {
      // Status mapping
      let statusClass = 'idea';
      let statusLabel = '아이디어';
      if (project.status === 'completed') {
        statusClass = 'completed';
        statusLabel = '완료';
      } else if (project.status === 'in-progress') {
        statusClass = 'in-progress';
        statusLabel = '개발 중';
      }

      // Tech tags HTML
      const techTagsHtml = project.techStack
        .map(tech => `<span class="tag-tech">${tech.trim()}</span>`)
        .join('');

      // Links validity
      const demoClass = project.demoUrl ? '' : 'disabled';
      const repoClass = project.repoUrl ? '' : 'disabled';

      // Prompt section (if exists)
      const promptSectionHtml = project.promptSummary 
        ? `
        <div class="card-vibe-box">
          <div class="vibe-title">
            <i data-lucide="zap"></i>
            <span>VIBE PROMPT</span>
          </div>
          <div class="vibe-prompt">${escapeHtml(project.promptSummary)}</div>
        </div>
        ` 
        : '';

      return `
        <article class="project-card glass-card" data-id="${project.id}">
          <div class="card-admin-tools">
            <button type="button" class="btn-admin-icon btn-edit" title="수정" data-id="${project.id}">
              <i data-lucide="edit-3"></i>
            </button>
            <button type="button" class="btn-admin-icon btn-delete" title="삭제" data-id="${project.id}">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
          <div class="card-header">
            <span class="card-category">${escapeHtml(project.category || '기타')}</span>
            <span class="badge-status ${statusClass}">
              <span class="status-dot"></span>
              ${statusLabel}
            </span>
          </div>
          <h2>${escapeHtml(project.title)}</h2>
          <p class="card-desc">${escapeHtml(project.description)}</p>
          
          <div class="card-tech-stack">
            ${techTagsHtml}
          </div>

          ${promptSectionHtml}

          <div class="card-actions">
            <div class="ai-tool-info">
              <i data-lucide="cpu"></i>
              <span>${escapeHtml(project.aiTools || 'AI 비지정')}</span>
            </div>
            <div class="action-links">
              <a href="${project.demoUrl || '#'}" class="action-link ${demoClass}" target="_blank" rel="noopener">
                <i data-lucide="external-link"></i> 데모
              </a>
              <a href="${project.repoUrl || '#'}" class="action-link ${repoClass}" target="_blank" rel="noopener">
                <i data-lucide="github"></i> 깃허브
              </a>
            </div>
          </div>
        </article>
      `;
    }).join('');

    // Re-initialize icons inside dynamic elements
    lucide.createIcons();
  }

  // Update top statistics panel
  function updateStats() {
    const total = projects.length;
    const completed = projects.filter(p => p.status === 'completed').length;
    const progress = projects.filter(p => p.status === 'in-progress').length;

    statTotal.textContent = total;
    statCompleted.textContent = completed;
    statProgress.textContent = progress;
  }

  // 5. Helper Utilities
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatUrl(url) {
    if (!url) return '';
    url = url.trim();
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }
    return url;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('active');
    setTimeout(() => {
      toast.classList.remove('active');
    }, 2500);
  }

  // 6. Setup Event Listeners
  function setupEventListeners() {
    // Real-time search input
    searchInput.addEventListener('input', (e) => {
      currentSearchQuery = e.target.value;
      render();
    });

    // Filter tabs
    filterButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        filterButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilterStatus = btn.dataset.status;
        render();
      });
    });

    // Modal open / close trigger
    btnOpenModal.addEventListener('click', () => {
      // Reset headers to "Create" mode
      document.querySelector('.modal-header h2').innerHTML = '<i data-lucide="folder-plus"></i> 새 프로젝트 등록';
      document.querySelector('#project-form button[type="submit"]').textContent = '등록하기';
      
      projectModal.classList.add('active');
      document.body.style.overflow = 'hidden';
    });

    const closeModal = () => {
      projectModal.classList.remove('active');
      projectForm.reset();
      document.getElementById('proj-id').value = ''; // Reset hidden ID
      document.body.style.overflow = '';
    };

    btnCloseModal.addEventListener('click', closeModal);
    btnCancelModal.addEventListener('click', closeModal);
    projectModal.addEventListener('click', (e) => {
      if (e.target === projectModal) closeModal();
    });

    // Submit new or edited project (Hybrid: Local vs Google Sheets API)
    projectForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const projIdVal = document.getElementById('proj-id').value;
      const title = document.getElementById('proj-title').value;
      const status = document.getElementById('proj-status').value;
      const category = document.getElementById('proj-category').value;
      const description = document.getElementById('proj-description').value;
      const techInput = document.getElementById('proj-tech').value;
      const aiTools = document.getElementById('proj-ai').value;
      const promptSummary = document.getElementById('proj-prompt').value;
      let demoUrl = document.getElementById('proj-demo').value.trim();
      let repoUrl = document.getElementById('proj-repo').value.trim();

      if (demoUrl) demoUrl = formatUrl(demoUrl);
      if (repoUrl) repoUrl = formatUrl(repoUrl);

      // Parse comma-separated tech stack
      const techStack = techInput
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);

      const submitBtn = projectForm.querySelector('button[type="submit"]');
      const originalBtnText = submitBtn.textContent;
      
      const sheetApiUrl = getSheetApiUrl();

      if (sheetApiUrl) {
        // --- 1. GOOGLE SHEETS SYNC MODE ---
        submitBtn.disabled = true;
        submitBtn.textContent = '구글 시트 저장 중...';

        const targetId = projIdVal ? parseInt(projIdVal) : Date.now();
        const createdAt = projIdVal 
          ? (projects.find(p => p.id === targetId)?.createdAt || new Date().toISOString().split('T')[0])
          : new Date().toISOString().split('T')[0];

        const projectData = {
          id: targetId,
          title,
          status,
          category,
          description,
          techStack,
          aiTools,
          promptSummary,
          demoUrl,
          repoUrl,
          createdAt
        };

        const payload = {
          action: projIdVal ? 'update' : 'add',
          data: projectData
        };

        try {
          // Google Apps Script Web App redirect requires redirect: 'follow'
          const response = await fetch(sheetApiUrl, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'text/plain' }, // Bypass preflight CORS checks
            redirect: 'follow'
          });

          if (response.ok) {
            const resData = await response.json();
            if (resData.status === 'success') {
              if (projIdVal) {
                const idx = projects.findIndex(p => p.id === targetId);
                if (idx > -1) projects[idx] = projectData;
              } else {
                projects.unshift(projectData);
              }
              saveToLocalStorage();
              render();
              closeModal();
              showToast(projIdVal ? '정보가 수정되었습니다!' : '새 프로젝트가 등록되었습니다!');
            } else {
              showToast('구글 시트 연동 실패: ' + resData.message);
            }
          } else {
            showToast('연동 서버 응답 오류가 발생했습니다.');
          }
        } catch (err) {
          console.error('GAS POST error:', err);
          showToast('네트워크 오류: 구글 시트 연동 저장에 실패했습니다.');
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = originalBtnText;
        }
      } else {
        // --- 2. LOCAL ONLY MODE ---
        if (projIdVal) {
          const targetId = parseInt(projIdVal);
          const index = projects.findIndex(p => p.id === targetId);
          if (index > -1) {
            projects[index] = {
              ...projects[index],
              title,
              status,
              category,
              description,
              techStack,
              aiTools,
              promptSummary,
              demoUrl,
              repoUrl
            };
            saveToLocalStorage();
            render();
            closeModal();
            showToast('프로젝트 정보가 수정되었습니다!');
          } else {
            showToast('수정 오류: 대상을 찾을 수 없습니다.');
          }
        } else {
          const newProject = {
            id: Date.now(),
            title,
            status,
            category,
            description,
            techStack,
            aiTools,
            promptSummary,
            demoUrl,
            repoUrl,
            createdAt: new Date().toISOString().split('T')[0]
          };

          projects.unshift(newProject);
          saveToLocalStorage();
          render();
          closeModal();
          showToast('새 프로젝트가 등록되었습니다!');
        }
      }
    });

    // Auto prefix https:// for URLs on blur to prevent HTML5 validation error
    const demoInput = document.getElementById('proj-demo');
    const repoInput = document.getElementById('proj-repo');

    [demoInput, repoInput].forEach(input => {
      input.addEventListener('blur', () => {
        let val = input.value.trim();
        if (val && !/^https?:\/\//i.test(val)) {
          input.value = 'https://' + val;
        }
      });
    });

    // Handle Edit & Delete via Event Delegation
    projectsGrid.addEventListener('click', (e) => {
      const btnEdit = e.target.closest('.btn-edit');
      const btnDelete = e.target.closest('.btn-delete');

      if (btnEdit) {
        const id = parseInt(btnEdit.dataset.id);
        openEditModal(id);
      } else if (btnDelete) {
        const id = parseInt(btnDelete.dataset.id);
        deleteProject(id);
      }
    });

    // Populate modal with project details for editing
    function openEditModal(id) {
      const project = projects.find(p => p.id === id);
      if (!project) return;

      // Populate input values
      document.getElementById('proj-id').value = project.id;
      document.getElementById('proj-title').value = project.title;
      document.getElementById('proj-status').value = project.status;
      document.getElementById('proj-category').value = project.category;
      document.getElementById('proj-description').value = project.description;
      document.getElementById('proj-tech').value = project.techStack.join(', ');
      document.getElementById('proj-ai').value = project.aiTools || '';
      document.getElementById('proj-prompt').value = project.promptSummary || '';
      document.getElementById('proj-demo').value = project.demoUrl || '';
      document.getElementById('proj-repo').value = project.repoUrl || '';

      // UI Text dynamic change
      document.querySelector('.modal-header h2').innerHTML = '<i data-lucide="edit-3"></i> 프로젝트 정보 수정';
      document.querySelector('#project-form button[type="submit"]').textContent = '수정 완료';
      
      // Update icons inside header
      lucide.createIcons();

      // Show modal
      projectModal.classList.add('active');
      document.body.style.overflow = 'hidden';
      
      // Update tech chips visual status
      setTimeout(updateChipHighlights, 50);
    }

    // Delete project with confirm check (Hybrid: Local vs Google Sheets API)
    async function deleteProject(id) {
      const project = projects.find(p => p.id === id);
      if (!project) return;

      if (!confirm(`정말 "${project.title}" 프로젝트를 삭제하시겠습니까?`)) {
        return;
      }

      const sheetApiUrl = getSheetApiUrl();

      if (sheetApiUrl) {
        showToast('구글 시트에서 삭제하는 중...');
        const payload = {
          action: 'delete',
          data: { id: id }
        };

        try {
          const response = await fetch(sheetApiUrl, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'text/plain' },
            redirect: 'follow'
          });

          if (response.ok) {
            const resData = await response.json();
            if (resData.status === 'success') {
              projects = projects.filter(p => p.id !== id);
              saveToLocalStorage();
              render();
              showToast('프로젝트가 삭제되었습니다.');
            } else {
              showToast('구글 시트 삭제 실패: ' + resData.message);
            }
          } else {
            showToast('연동 서버 삭제 처리 중 오류가 발생했습니다.');
          }
        } catch (err) {
          console.error('GAS Delete error:', err);
          showToast('네트워크 오류: 구글 시트에서 삭제하지 못했습니다.');
        }
      } else {
        projects = projects.filter(p => p.id !== id);
        saveToLocalStorage();
        render();
        showToast('프로젝트가 삭제되었습니다.');
      }
    }

    // Update chip styling based on text input
    function updateChipHighlights() {
      const currentTechs = projTechInput.value
        .split(',')
        .map(t => t.trim().toLowerCase())
        .filter(t => t.length > 0);

      stackChips.forEach(chip => {
        const val = chip.dataset.value.toLowerCase();
        if (currentTechs.includes(val)) {
          chip.classList.add('selected');
        } else {
          chip.classList.remove('selected');
        }
      });
    }

    // Toggle tech chips
    stackChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const val = chip.dataset.value;
        let currentTechs = projTechInput.value
          .split(',')
          .map(t => t.trim())
          .filter(t => t.length > 0);

        const index = currentTechs.findIndex(t => t.toLowerCase() === val.toLowerCase());
        if (index > -1) {
          // Remove if already exists
          currentTechs.splice(index, 1);
        } else {
          // Add if not exists
          currentTechs.push(val);
        }

        projTechInput.value = currentTechs.join(', ');
        updateChipHighlights();

        // Auto detect and select category
        const recommendedCategory = autoDetectCategory(currentTechs, document.getElementById('proj-demo').value || document.getElementById('proj-repo').value);
        if (recommendedCategory) {
          document.getElementById('proj-category').value = recommendedCategory;
        }
      });
    });

    // Real-time chip sync and auto category selection when user types manually
    projTechInput.addEventListener('input', () => {
      updateChipHighlights();

      const currentTechs = projTechInput.value
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);

      const recommendedCategory = autoDetectCategory(currentTechs, document.getElementById('proj-demo').value || document.getElementById('proj-repo').value);
      if (recommendedCategory) {
        document.getElementById('proj-category').value = recommendedCategory;
      }
    });

    // Sync highlights when modal opens or resets
    btnOpenModal.addEventListener('click', () => {
      setTimeout(updateChipHighlights, 50); // Small delay to let input render
    });

    // Auto-detect project category based on url or tech stack
    function autoDetectCategory(techs, url) {
      const urlLower = (url || '').toLowerCase();
      const techsLower = techs.map(t => t.toLowerCase());

      // 1. Automation / GAS
      if (urlLower.includes('script.google.com') || techsLower.includes('google apps script') || techsLower.includes('gas')) {
        return 'Automation / GAS';
      }
      
      // 2. Bot / CLI
      if (techsLower.includes('discord.js') || techsLower.includes('discord.py') || techsLower.includes('python-telegram-bot') || techsLower.includes('cli') || techsLower.includes('shell') || techsLower.includes('bash')) {
        return 'Bot / CLI';
      }

      // 3. Chrome Extension
      if (techsLower.includes('chrome extension') || techsLower.includes('chrome-extension') || techsLower.includes('extension')) {
        return 'Chrome Extension';
      }

      // 4. Desktop App
      if (techsLower.includes('electron') || techsLower.includes('tauri') || techsLower.includes('pyqt') || techsLower.includes('tkinter') || techsLower.includes('desktop app')) {
        return 'Desktop App';
      }

      // 5. Web App (Default fallback if typical web techs or streamlit are found)
      if (
        urlLower.includes('netlify.app') || 
        urlLower.includes('vercel.app') || 
        urlLower.includes('github.io') || 
        urlLower.includes('streamlit.app') ||
        techsLower.includes('react') ||
        techsLower.includes('vue') ||
        techsLower.includes('svelte') ||
        techsLower.includes('next.js') ||
        techsLower.includes('vite') ||
        techsLower.includes('streamlit') ||
        techsLower.includes('typescript')
      ) {
        return 'Web App';
      }

      // General web files
      if (techsLower.includes('html') || techsLower.includes('javascript') || techsLower.includes('css')) {
        return 'Web App';
      }

      return null;
    }

    // Demo URL analysis (Pattern matching)
    btnAnalyzeDemo.addEventListener('click', () => {
      const url = document.getElementById('proj-demo').value.trim();
      if (!url) {
        showToast('먼저 데모 링크 URL을 입력해 주세요.');
        return;
      }

      const detected = [];
      const urlLower = url.toLowerCase();

      if (urlLower.includes('script.google.com')) {
        detected.push('Google Apps Script', 'JavaScript');
      }
      if (urlLower.includes('github.io') || urlLower.includes('netlify.app') || urlLower.includes('vercel.app')) {
        detected.push('HTML', 'CSS', 'JavaScript');
      }
      if (urlLower.includes('streamlit.app')) {
        detected.push('Python', 'Streamlit');
      }

      if (detected.length > 0) {
        // Merge with existing tech stack
        let currentTechs = projTechInput.value
          .split(',')
          .map(t => t.trim())
          .filter(t => t.length > 0);

        detected.forEach(tech => {
          if (!currentTechs.some(t => t.toLowerCase() === tech.toLowerCase())) {
            currentTechs.push(tech);
          }
        });

        projTechInput.value = currentTechs.join(', ');
        updateChipHighlights();

        // Auto detect and select category
        const recommendedCategory = autoDetectCategory(currentTechs, url);
        if (recommendedCategory) {
          document.getElementById('proj-category').value = recommendedCategory;
          showToast(`기술 감지 완료: ${detected.join(', ')} / 카테고리 자동 설정: [${recommendedCategory}]`);
        } else {
          showToast(`주소 패턴에서 기술 감지 완료: ${detected.join(', ')}`);
        }
      } else {
        showToast('해당 주소에서 감지된 패턴이 없습니다. 추천 칩에서 직접 선택해 보세요!');
      }
    });

    // Repository URL analysis (GitHub API)
    btnAnalyzeRepo.addEventListener('click', async () => {
      const url = document.getElementById('proj-repo').value.trim();
      if (!url) {
        showToast('먼저 저장소 URL을 입력해 주세요.');
        return;
      }

      if (!url.toLowerCase().includes('github.com')) {
        showToast('GitHub 레포지토리 주소만 자동 분석을 지원합니다.');
        return;
      }

      // Regex to extract owner and repo
      const match = url.match(/github\.com\/([^\/]+)\/([^\/\?#]+)/);
      if (!match) {
        showToast('올바른 GitHub 저장소 형식이 아닙니다. (예: github.com/user/repo)');
        return;
      }

      const owner = match[1];
      const repo = match[2];

      btnAnalyzeRepo.disabled = true;
      const originalText = btnAnalyzeRepo.textContent;
      btnAnalyzeRepo.textContent = '분석 중...';

      try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/languages`);
        if (response.ok) {
          const data = await response.json();
          const detectedLanguages = Object.keys(data); // e.g. ["JavaScript", "HTML", "CSS"]

          if (detectedLanguages.length > 0) {
            let currentTechs = projTechInput.value
              .split(',')
              .map(t => t.trim())
              .filter(t => t.length > 0);

            detectedLanguages.forEach(tech => {
              if (!currentTechs.some(t => t.toLowerCase() === tech.toLowerCase())) {
                currentTechs.push(tech);
              }
            });

            projTechInput.value = currentTechs.join(', ');
            updateChipHighlights();

            // Auto detect and select category
            const recommendedCategory = autoDetectCategory(currentTechs, url);
            if (recommendedCategory) {
              document.getElementById('proj-category').value = recommendedCategory;
              showToast(`GitHub 언어 감지 완료: ${detectedLanguages.join(', ')} / 카테고리 자동 설정: [${recommendedCategory}]`);
            } else {
              showToast(`GitHub에서 기술 감지 완료: ${detectedLanguages.join(', ')}`);
            }
          } else {
            showToast('저장소에 등록된 프로그래밍 코드가 없습니다.');
          }
        } else {
          showToast('저장소 분석 실패: 존재하지 않는 레포지토리이거나 제한을 초과했습니다.');
        }
      } catch (err) {
        console.error('GitHub API error:', err);
        showToast('네트워크 오류: API 호출에 실패했습니다.');
      } finally {
        btnAnalyzeRepo.disabled = false;
        btnAnalyzeRepo.textContent = originalText;
      }
    });

    // Copy JSON schema to clipboard
    btnCopyJson.addEventListener('click', () => {
      const jsonString = JSON.stringify(projects, null, 2);
      navigator.clipboard.writeText(jsonString)
        .then(() => showToast('클립보드에 JSON 데이터 복사 완료!'))
        .catch(err => {
          console.error('Copy failed', err);
          showToast('복사에 실패했습니다. 개발자 도구 콘솔을 확인하세요.');
        });
    });

    // Download JSON as file
    btnDownloadJson.addEventListener('click', () => {
      const jsonString = JSON.stringify(projects, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = 'projects.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      showToast('projects.json 파일 다운로드 시작!');
    });

    // --- Google Sheets Settings Modal Controls ---
    btnOpenSettings.addEventListener('click', () => {
      let savedApiUrl = localStorage.getItem('sheet_api_url') || '';
      if (savedApiUrl === 'none') savedApiUrl = '';
      settingsApiUrlInput.value = savedApiUrl;
      settingsModal.classList.add('active');
      document.body.style.overflow = 'hidden';
    });

    const closeSettingsModal = () => {
      settingsModal.classList.remove('active');
      document.body.style.overflow = '';
    };

    btnCloseSettings.addEventListener('click', closeSettingsModal);
    btnCancelSettings.addEventListener('click', closeSettingsModal);
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) closeSettingsModal();
    });

    // Save Settings
    btnSaveSettings.addEventListener('click', async () => {
      const url = settingsApiUrlInput.value.trim();
      if (!url) {
        showToast('API URL을 입력하거나 연동 해제를 선택하세요.');
        return;
      }

      if (!url.startsWith('https://script.google.com/')) {
        showToast('올바른 Google Apps Script Web App URL이 아닙니다.');
        return;
      }

      localStorage.setItem('sheet_api_url', url);
      updateSyncIndicator();
      closeSettingsModal();
      showToast('구글 시트 API 연동이 설정되었습니다!');
      
      // Reload projects from sheets
      await fetchFromGoogleSheets(url);
    });

    // Clear Settings
    btnClearSettings.addEventListener('click', () => {
      if (confirm('구글 시트 연동을 해제하고 로컬 모드로 전환하시겠습니까?')) {
        localStorage.setItem('sheet_api_url', 'none');
        settingsApiUrlInput.value = '';
        updateSyncIndicator();
        closeSettingsModal();
        showToast('연동이 해제되었습니다. 로컬 데이터를 불러옵니다.');
        
        // Reload from local fallback
        loadLocalFallback();
      }
    });
  }

  // Trigger init
  init();
});
