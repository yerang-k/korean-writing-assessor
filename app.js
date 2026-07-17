let state = {
    apiKey: '',
    selectedModel: 'gemini-2.5-flash', // Automatically updated based on API key permissions
    teacherPassword: '1234', // Default password for teacher mode lock
    assignment: {
        title: '',
        passage: '',
        topic: '',
        minChar: 400,
        maxChar: 800
    },
    rubrics: [], // Array of { id, title, description, maxScore }
    results: [],  // Array of evaluation results
    currentResultId: null, // ID of the currently viewed result
    sheetUrl: '', // Google Spreadsheet Web App URL
    studentInfo: {
        grade: '',
        class: '',
        number: '',
        name: ''
    },
    submissions: [], // Accumulated student submissions loaded from Google Sheets
    selectedSubmissionId: null,
    assignmentLibrary: [] // 저장된 과제 설계 보관함 [{ id, savedAt, assignment, rubrics }]
};

// --- LocalStorage Logic ---
const STORAGE_KEYS = {
    API_KEY: 'kwa_api_key',
    SELECTED_MODEL: 'kwa_selected_model',
    TEACHER_PASSWORD: 'kwa_teacher_password',
    ASSIGNMENT: 'kwa_assignment',
    RUBRICS: 'kwa_rubrics',
    RESULTS: 'kwa_results',
    SHEET_URL: 'kwa_sheet_url',
    STUDENT_INFO: 'kwa_student_info',
    ASSIGNMENT_LIBRARY: 'kwa_assignment_library'
};

function loadStateFromStorage() {
    state.apiKey = localStorage.getItem(STORAGE_KEYS.API_KEY) || '';
    state.selectedModel = localStorage.getItem(STORAGE_KEYS.SELECTED_MODEL) || 'gemini-2.5-flash';
    state.teacherPassword = localStorage.getItem(STORAGE_KEYS.TEACHER_PASSWORD) || '1234';
    state.sheetUrl = localStorage.getItem(STORAGE_KEYS.SHEET_URL) || '';
    
    const savedAssignment = localStorage.getItem(STORAGE_KEYS.ASSIGNMENT);
    if (savedAssignment) {
        state.assignment = JSON.parse(savedAssignment);
    }
    
    const savedRubrics = localStorage.getItem(STORAGE_KEYS.RUBRICS);
    if (savedRubrics) {
        state.rubrics = JSON.parse(savedRubrics);
    }
    
    const savedResults = localStorage.getItem(STORAGE_KEYS.RESULTS);
    if (savedResults) {
        state.results = JSON.parse(savedResults);
        if (state.results.length > 0) {
            state.currentResultId = state.results[0].id;
        }
    }
    
    const savedStudentInfo = localStorage.getItem(STORAGE_KEYS.STUDENT_INFO);
    if (savedStudentInfo) {
        state.studentInfo = JSON.parse(savedStudentInfo);
    }

    const savedLibrary = localStorage.getItem(STORAGE_KEYS.ASSIGNMENT_LIBRARY);
    if (savedLibrary) {
        state.assignmentLibrary = JSON.parse(savedLibrary);
    }
}

function saveStateToStorage() {
    localStorage.setItem(STORAGE_KEYS.API_KEY, state.apiKey);
    localStorage.setItem(STORAGE_KEYS.SELECTED_MODEL, state.selectedModel);
    localStorage.setItem(STORAGE_KEYS.TEACHER_PASSWORD, state.teacherPassword);
    localStorage.setItem(STORAGE_KEYS.ASSIGNMENT, JSON.stringify(state.assignment));
    localStorage.setItem(STORAGE_KEYS.RUBRICS, JSON.stringify(state.rubrics));
    localStorage.setItem(STORAGE_KEYS.RESULTS, JSON.stringify(state.results));
    localStorage.setItem(STORAGE_KEYS.SHEET_URL, state.sheetUrl);
    localStorage.setItem(STORAGE_KEYS.STUDENT_INFO, JSON.stringify(state.studentInfo));
    localStorage.setItem(STORAGE_KEYS.ASSIGNMENT_LIBRARY, JSON.stringify(state.assignmentLibrary));
}

// --- Toast / Notification System ---
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let iconName = 'info';
    if (type === 'success') iconName = 'check-circle-2';
    if (type === 'error') iconName = 'alert-octagon';
    
    toast.innerHTML = `
        <i data-lucide="${iconName}"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    lucide.createIcons({ attrs: { class: 'toast-icon' } });
    
    // Slide out and remove
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- Loading Overlay Controller ---
function showLoading(message, submessage = '잠시만 기다려 주세요 (약 5~15초 소요)') {
    const overlay = document.getElementById('loading-overlay');
    document.getElementById('loading-message').textContent = message;
    overlay.querySelector('.loading-submessage').textContent = submessage;
    overlay.style.display = 'flex';
}

function hideLoading() {
    document.getElementById('loading-overlay').style.display = 'none';
}

// --- API Connector (Gemini REST API) ---
// --- Helper to parse JSON from Markdown Code Blocks ---
function parseCleanJson(text) {
    let cleanText = text.trim();
    
    // Markdown code block (```json ... ```) 제거
    const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/;
    const matches = cleanText.match(jsonBlockRegex);
    if (matches && matches[1]) {
        cleanText = matches[1].trim();
    } else {
        // 일반 백틱 block (``` ... ```) 제거
        const codeBlockRegex = /```\s*([\s\S]*?)\s*```/;
        const matchesAlt = cleanText.match(codeBlockRegex);
        if (matchesAlt && matchesAlt[1]) {
            cleanText = matchesAlt[1].trim();
        }
    }
    
    // 대괄호 [ 또는 중괄호 { 의 위치를 찾아 앞뒤의 노이즈 텍스트 제거
    const firstBracketIdx = cleanText.indexOf('[');
    const firstBraceIdx = cleanText.indexOf('{');
    let startIdx = -1;
    let endIdx = -1;
    
    if (firstBracketIdx !== -1 && (firstBraceIdx === -1 || firstBracketIdx < firstBraceIdx)) {
        // 배열 형태 [ ... ]
        startIdx = firstBracketIdx;
        endIdx = cleanText.lastIndexOf(']');
    } else if (firstBraceIdx !== -1) {
        // 객체 형태 { ... }
        startIdx = firstBraceIdx;
        endIdx = cleanText.lastIndexOf('}');
    }
    
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        cleanText = cleanText.substring(startIdx, endIdx + 1);
    }
    
    try {
        return JSON.parse(cleanText);
    } catch (e) {
        console.error('JSON Parsing failed on text:', cleanText);
        throw new Error('AI의 응답 데이터 형식이 올바르지 않습니다. 다시 시도해 주세요.');
    }
}

// --- API Connector (Gemini REST API) ---
// 2024년 이후 Gemini API는 v1beta 엔드포인트에서 최신 모델(2.x 계열)을 제공합니다.
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// 지정한 모델로 generateContent 요청을 보내는 저수준 함수
async function requestGemini(model, prompt, key) {
    const apiKey = key || state.apiKey;
    const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;
    const requestBody = {
        contents: [
            { parts: [{ text: prompt }] }
        ]
    };
    return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    });
}

// 오류가 '모델을 사용할 수 없음'(지원 종료·미지원 모델 등) 유형인지 판별
function isModelUnavailableError(status, message) {
    if (status === 404) return true;
    const m = (message || '').toLowerCase();
    return m.includes('not found') || m.includes('not supported') ||
           m.includes('deprecated') || m.includes('is not available') ||
           m.includes('unsupported') || m.includes('call listmodels');
}

async function callGemini(prompt, useJson = true) {
    if (!state.apiKey) {
        throw new Error('API Key가 등록되지 않았습니다. [설정 & API] 탭에서 등록해 주세요.');
    }

    let model = state.selectedModel || 'gemini-2.5-flash';

    // 1차 시도
    let response = await requestGemini(model, prompt);

    // 저장된 모델을 쓸 수 없는 경우(예: 지원 종료된 gemini-1.5-flash),
    // 사용 가능한 모델을 자동으로 다시 찾아 1회 재시도합니다.
    // (학생이 공유 링크로 접속해 API 키 검증을 거치지 않은 경우에도 채점이 되도록 하는 안전장치)
    if (!response.ok) {
        let firstErrMsg = '';
        try { firstErrMsg = (await response.clone().json()).error?.message || ''; } catch (e) {}
        if (isModelUnavailableError(response.status, firstErrMsg)) {
            try {
                const working = await discoverWorkingModel(state.apiKey);
                if (working) {
                    model = working;
                    state.selectedModel = working;
                    saveStateToStorage();
                    response = await requestGemini(model, prompt);
                }
            } catch (e) {
                console.warn('작동 모델 자동 탐색 실패:', e.message);
            }
        }
    }

    if (!response.ok) {
        let errData = {};
        try { errData = await response.json(); } catch (e) {}
        throw new Error(errData.error?.message || 'Gemini API 호출에 실패했습니다.');
    }

    const data = await response.json();
    const textResult = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!textResult) {
        throw new Error('API가 빈 결과를 반환했습니다.');
    }

    if (useJson) {
        return parseCleanJson(textResult);
    }
    return textResult;
}

// --- 사용 가능한 Gemini 모델 자동 탐색 ---
// 계정에서 접근 가능한 모델 목록을 받아 최신 안정 모델부터 실제 호출 테스트를 수행하고,
// 정상 응답하는 첫 모델 이름을 반환합니다.
async function discoverWorkingModel(key) {
    const listUrl = `${GEMINI_API_BASE}/models?key=${key || state.apiKey}`;
    const response = await fetch(listUrl, { method: 'GET' });
    if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error?.message || `API 키 오류 (코드: ${response.status})`);
    }

    const data = await response.json();
    if (!data.models || data.models.length === 0) {
        throw new Error('사용 가능한 AI 모델이 계정에 존재하지 않습니다.');
    }

    // generateContent를 지원하는 gemini 모델만 추출
    const geminiModels = data.models
        .filter(m => !m.supportedGenerationMethods ||
                     m.supportedGenerationMethods.includes('generateContent'))
        .map(m => m.name.replace('models/', ''))
        .filter(name => name.toLowerCase().includes('gemini'));

    if (geminiModels.length === 0) {
        throw new Error('이 API Key로 액세스할 수 있는 Gemini 모델이 없습니다.');
    }

    // 최신 안정 모델을 우선 사용하도록 정렬 (2.5-flash > 2.0-flash > flash-latest > 기타).
    // 지원 종료 가능성이 있는 1.5 계열은 가장 뒤로 미룹니다.
    const rank = (name) => {
        const n = name.toLowerCase();
        if (n.includes('preview') || n.includes('exp')) return 8; // 실험/프리뷰는 뒤로
        if (n.includes('2.5-flash') && !n.includes('lite')) return 0;
        if (n.includes('2.0-flash') && !n.includes('lite')) return 1;
        if (n.includes('flash-latest')) return 2;
        if (n.includes('2.5-flash')) return 3;
        if (n.includes('2.0-flash')) return 4;
        if (n.includes('flash') && !n.includes('1.5')) return 5;
        if (n.includes('1.5')) return 9; // 지원 종료 가능성 → 최후순위
        return 7;
    };
    geminiModels.sort((a, b) => rank(a) - rank(b));
    console.log('Testing Gemini models in order:', geminiModels);

    let lastErrorMessage = '';
    for (const model of geminiModels) {
        try {
            const testResponse = await requestGemini(model, 'Hello', key);
            if (testResponse.ok) {
                return model; // 활성 쿼터가 있는 작동 모델 발견!
            }
            const errData = await testResponse.json().catch(() => ({}));
            lastErrorMessage = errData.error?.message || `코드 ${testResponse.status}`;
            console.warn(`Model ${model} test failed:`, lastErrorMessage);
        } catch (err) {
            lastErrorMessage = err.message || '네트워크 오류';
            console.warn(`Model ${model} test error:`, lastErrorMessage);
        }
    }
    throw new Error(`사용 가능한 모든 AI 모델의 쿼터 한도가 초과되었거나 제한되어 있습니다. (최종 실패 사유: ${lastErrorMessage})`);
}

// --- API Validation ---
async function validateApiKey(key) {
    const matchedModel = await discoverWorkingModel(key);
    state.selectedModel = matchedModel;
    console.log('Successfully validated API Key. Selected active model:', matchedModel);
    return true;
}

// --- UI rendering & Interaction Logic ---

// Tab switching
function setupTabs() {
    const navItems = document.querySelectorAll('.nav-item');
    const tabPanels = document.querySelectorAll('.tab-panel');
    
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            const targetTab = item.getAttribute('data-tab');
            
            // 2단계 비밀번호 체크: 교사용(config, teacher, submissions) 탭 진입 시
            if (targetTab === 'config' || targetTab === 'teacher' || targetTab === 'submissions') {
                const isVerified = sessionStorage.getItem('kwa_is_teacher') === 'true';
                
                // 비밀번호가 설정되어 있고 인증이 안 된 경우에만 창 표시
                if (state.teacherPassword && !isVerified) {
                    const passwordAttempt = prompt('교사 인증 비밀번호를 입력해 주세요:');
                    
                    if (passwordAttempt === state.teacherPassword) {
                        sessionStorage.setItem('kwa_is_teacher', 'true');
                        showToast('인증되었습니다.', 'success');
                    } else {
                        if (passwordAttempt !== null) {
                            showToast('비밀번호가 올바르지 않습니다.', 'error');
                        }
                        // 이벤트 기본 동작 중단
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }
                }
            }
            
            // Activate sidebar nav item
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            
            // Activate panel
            tabPanels.forEach(panel => panel.classList.remove('active'));
            const activePanel = document.getElementById(`tab-${targetTab}`);
            activePanel.classList.add('active');
            
            // View specific setup when switching tabs
            if (targetTab === 'student') {
                renderStudentView();
            } else if (targetTab === 'results') {
                renderResultsView();
            } else if (targetTab === 'submissions') {
                loadSubmissionsFromGoogleSheets();
            }
        });
    });
}

// Update API Status indicator
function updateApiStatusIndicator() {
    const indicator = document.getElementById('api-status-indicator');
    const dot = indicator.querySelector('.status-dot');
    const text = indicator.querySelector('.status-text');
    
    if (state.apiKey) {
        dot.className = 'status-dot green';
        text.textContent = 'Gemini API 연결됨';
    } else {
        dot.className = 'status-dot red';
        text.textContent = 'Gemini API 미연결';
    }
}

// API Key management
function setupApiKeyHandlers() {
    const keyInput = document.getElementById('api-key-input');
    const btnToggle = document.getElementById('btn-toggle-key-visibility');
    const btnSave = document.getElementById('btn-save-api-key');
    const btnReset = document.getElementById('btn-reset-data');
    
    // Load existing key to UI
    if (state.apiKey) {
        keyInput.value = state.apiKey;
    }
    
    // Toggle key visibility
    btnToggle.addEventListener('click', () => {
        const icon = btnToggle.querySelector('i');
        if (keyInput.type === 'password') {
            keyInput.type = 'text';
            icon.setAttribute('data-lucide', 'eye-off');
        } else {
            keyInput.type = 'password';
            icon.setAttribute('data-lucide', 'eye');
        }
        lucide.createIcons();
    });
    
    // Save API key
    btnSave.addEventListener('click', async () => {
        const enteredKey = keyInput.value.trim();
        if (!enteredKey) {
            showToast('API Key를 입력해 주세요.', 'error');
            return;
        }
        
        showLoading('API Key 검증 중...', 'Google AI 서버에 연결을 시도하고 있습니다.');
        try {
            await validateApiKey(enteredKey);
            state.apiKey = enteredKey;
            saveStateToStorage();
            updateApiStatusIndicator();
            showToast('API Key가 성공적으로 연동되었습니다!', 'success');
        } catch (error) {
            showToast(`검증 실패: ${error.message}`, 'error');
        } finally {
            hideLoading();
        }
    });

    // Reset database
    btnReset.addEventListener('click', () => {
        if (confirm('모든 설정, 루브릭 및 학생 평가 결과 목록이 삭제됩니다. 정말 삭제하시겠습니까?')) {
            localStorage.clear();
            state = {
                apiKey: '',
                assignment: { title: '', passage: '', topic: '', minChar: 400, maxChar: 800 },
                rubrics: [],
                results: [],
                currentResultId: null
            };
            keyInput.value = '';
            document.getElementById('assignment-title').value = '';
            document.getElementById('assignment-passage').value = '';
            document.getElementById('assignment-topic').value = '';
            document.getElementById('min-char-count').value = 400;
            document.getElementById('max-char-count').value = 800;
            
            updateApiStatusIndicator();
            renderRubricList();
            showToast('모든 데이터가 초기화되었습니다.', 'info');
        }
    });
}

// --- Teacher View Logic ---
function setupTeacherViewHandlers() {
    const titleInput = document.getElementById('assignment-title');
    const passageInput = document.getElementById('assignment-passage');
    const topicInput = document.getElementById('assignment-topic');
    const minCharInput = document.getElementById('min-char-count');
    const maxCharInput = document.getElementById('max-char-count');
    const btnGenRubric = document.getElementById('btn-generate-rubric');
    const btnAddItem = document.getElementById('btn-add-rubric-item');

    // Populate inputs from state
    titleInput.value = state.assignment.title;
    passageInput.value = state.assignment.passage;
    topicInput.value = state.assignment.topic;
    minCharInput.value = state.assignment.minChar;
    maxCharInput.value = state.assignment.maxChar;

    // Local changes sync to state and LocalStorage
    const syncAssignment = () => {
        state.assignment.title = titleInput.value.trim();
        state.assignment.passage = passageInput.value.trim();
        state.assignment.topic = topicInput.value.trim();
        state.assignment.minChar = parseInt(minCharInput.value) || 0;
        state.assignment.maxChar = parseInt(maxCharInput.value) || 0;
        saveStateToStorage();
    };

    [titleInput, passageInput, topicInput, minCharInput, maxCharInput].forEach(element => {
        element.addEventListener('input', syncAssignment);
    });

    // Add Rubric item manually
    btnAddItem.addEventListener('click', () => {
        const newItem = {
            id: 'rubric-' + Date.now(),
            title: '새 평가 영역',
            description: '채점 기준을 입력하세요.',
            maxScore: 20
        };
        state.rubrics.push(newItem);
        saveStateToStorage();
        renderRubricList();
    });

    // AI Rubric Generation
    btnGenRubric.addEventListener('click', async () => {
        const topic = topicInput.value.trim();
        if (!topic) {
            showToast('글쓰기 논제 및 요구사항을 입력해 주세요.', 'error');
            return;
        }

        if (!state.apiKey) {
            showToast('API Key가 필요합니다. [설정 & API] 탭을 확인하세요.', 'error');
            return;
        }

        showLoading('AI 평가 기준(루브릭) 생성 중...', '지문과 요구사항을 바탕으로 채점 기준을 추출하는 중입니다.');
        
        const prompt = `
당신은 대한민국의 고등학교 국어 교사입니다. 교사가 제시한 글쓰기 주제(논제)와 지문을 분석하여, 학생들의 글을 객관적으로 평가할 수 있는 맞춤형 평가 기준(루브릭)을 자동으로 설계해 주세요.

[글쓰기 제목]: ${titleInput.value.trim()}
[읽기 지문]: ${passageInput.value.trim()}
[글쓰기 논제 및 요구사항]: ${topic}

수행 평가 성격에 맞는 3~5개의 세부 평가 기준 항목을 생성해 주세요. (예: 내용의 타당성, 구성 및 조직, 표현의 적절성, 맞춤법 및 문장 등)
각 항목의 배점 합계는 반드시 총 100점이 되어야 합니다.

출력은 반드시 다른 부가 텍스트 없이 오직 하단의 JSON 형식을 엄격히 준수하여 응답해 주세요.

JSON Schema 형식:
\`\`\`json
[
  {
    "title": "평가 영역 제목 (예: 내용의 적절성)",
    "description": "이 영역의 채점 기준 설명 (예: 지문에 제시된 핵심 문제를 정확히 이해하고 가치관의 변화를 타당한 이유를 들어 서술하였는가?)",
    "maxScore": 배점 숫자 (예: 30)
  }
]
\`\`\`
`;

        try {
            const aiRubric = await callGemini(prompt, true);
            if (Array.isArray(aiRubric) && aiRubric.length > 0) {
                // Map generated rubric into state
                state.rubrics = aiRubric.map((item, idx) => ({
                    id: 'rubric-ai-' + idx + '-' + Date.now(),
                    title: item.title || '평가 항목',
                    description: item.description || '세부 채점 기준',
                    maxScore: Number(item.maxScore) || 20
                }));
                saveStateToStorage();
                renderRubricList();
                showToast('평가 기준이 자동으로 생성되었습니다!', 'success');
            } else {
                throw new Error('올바른 루브릭 형식이 생성되지 않았습니다.');
            }
        } catch (error) {
            showToast(`루브릭 생성 실패: ${error.message}`, 'error');
        } finally {
            hideLoading();
        }
    });

    // --- 2022 Curriculum Recommendation Logic ---
    const btnToggleRecommender = document.getElementById('btn-toggle-recommender');
    const recommenderContent = document.getElementById('recommender-content');
    const btnGetRecommendations = document.getElementById('btn-get-topic-recommendations');
    const recommendationsResults = document.getElementById('recommendations-results');
    const selectSubject = document.getElementById('select-subject');
    const inputCurriculumKeyword = document.getElementById('input-curriculum-keyword');
    
    // Accordion Toggle
    btnToggleRecommender.addEventListener('click', () => {
        const container = btnToggleRecommender.closest('.accordion-recommender');
        if (recommenderContent.style.display === 'none') {
            recommenderContent.style.display = 'block';
            container.classList.add('open');
        } else {
            recommenderContent.style.display = 'none';
            container.classList.remove('open');
        }
    });
    
    // Get Recommendations from Gemini
    btnGetRecommendations.addEventListener('click', async () => {
        const subject = selectSubject.value;
        const keyword = inputCurriculumKeyword.value.trim();
        
        if (!keyword) {
            showToast('성취기준이나 단원 핵심 키워드를 입력해 주세요.', 'error');
            return;
        }
        
        if (!state.apiKey) {
            showToast('API Key가 필요합니다. [설정 & API] 탭을 확인하세요.', 'error');
            return;
        }
        
        showLoading('2022 성취기준 기반 글쓰기 주제 추천 중...', '교육과정을 매칭하여 매끄럽고 명확한 수행평가 논제와 지문을 추천받고 있습니다.');
        
        const prompt = `
당신은 대한민국의 고등학교 국어 교사이자 2022 개정 교육과정 연구원입니다.
선택한 고등학교 국어과 과목과 교사가 다루고자 하는 단원의 성취기준 키워드를 반영하여, 수업 시간에 활용할 수 있는 서술형/작문 수행평가 글쓰기 주제 3가지를 설계하여 제시해 주십시오.

[선택 과목]: ${subject}
[성취기준 / 단원 핵심 키워드]: ${keyword}

추천 주제 조건:
1. 2022 개정 교육과정 고등학교 국어과 성취기준에 명확히 부합해야 하며, 성취기준 코드(예: [12화작03-02])와 간략한 내용을 함께 제공하십시오.
2. 학생들이 해결할 수행평가 과제명, 구체적인 논제(수행 요령 및 글자 수 제한 등), 그리고 작성을 위해 참고할 만한 '추천 지문 제목과 범위'를 상세히 작성해 주십시오.
3. 3가지 제안은 난이도나 세부 글쓰기 갈래(설명하는 글, 주장하는 글, 비평 등)가 다양하게 구성되도록 차별성을 두십시오.

출력은 반드시 다른 부가 텍스트 없이 오직 하단의 JSON 형식을 엄격히 준수하여 응답해 주세요.

JSON Schema 형식:
\`\`\`json
[
  {
    "title": "추천 수행평가 과제 제목 (예: [독서] 비판적 독해에 기반한 미디어 시평 쓰기)",
    "achievement": "[성취기준코드] 성취기준 내용 (예: [12독작02-04] 매체의 신뢰성과 타당성을 평가하며 읽고...)",
    "topic": "구체적인 학생 글쓰기 논제 및 작성 조건 (예: 제시된 신문 기사 사설의 주장과 근거를 분석하고, 이에 대한 자신의 비판적 입장을 논리적 근거를 들어 500자 내외로 논술하시오.)",
    "suggestedPassage": "추천 지문이나 작가 정보 (예: '시사 인문학 사설 2편' 혹은 '유길준의 서유견문 일부')"
  }
]
\`\`\`
`;
        
        try {
            const recommendations = await callGemini(prompt, true);
            
            if (Array.isArray(recommendations) && recommendations.length > 0) {
                recommendationsResults.innerHTML = '';
                recommendationsResults.style.display = 'flex';
                
                recommendations.forEach((rec, idx) => {
                    const card = document.createElement('div');
                    card.className = 'recommendation-card';
                    card.innerHTML = `
                        <h4>${rec.title || '추천 과제'}</h4>
                        <span class="recommendation-achievement">${rec.achievement || '성취기준 미지정'}</span>
                        <p class="recommendation-topic">${rec.topic || '논제 정보 없음'}</p>
                        <div class="recommendation-passage-tip">💡 추천 지문: ${rec.suggestedPassage || '자율 지문'}</div>
                        <button type="button" class="btn-apply-recommendation">이 주제 적용하기</button>
                    `;
                    
                    // Bind 'Apply' event
                    card.querySelector('.btn-apply-recommendation').addEventListener('click', () => {
                        titleInput.value = rec.title;
                        topicInput.value = rec.topic;
                        
                        // Set custom placeholder for passage based on recommended text
                        if (rec.suggestedPassage && rec.suggestedPassage !== '자율 지문' && rec.suggestedPassage !== '별도 지문 없음') {
                            passageInput.value = `[추천 지문: ${rec.suggestedPassage}]\n이곳에 관련 지문 텍스트를 붙여넣어 주세요.`;
                        } else {
                            passageInput.value = '';
                        }
                        
                        // Sync UI and storage
                        syncAssignment();
                        
                        // Close Recommender Accordion
                        recommenderContent.style.display = 'none';
                        btnToggleRecommender.closest('.accordion-recommender').classList.remove('open');
                        
                        showToast(`'${rec.title}' 주제가 적용되었습니다!`, 'success');
                    });
                    
                    recommendationsResults.appendChild(card);
                });
                
                showToast('성취기준 부합 글쓰기 주제 3가지가 제안되었습니다.', 'success');
            } else {
                throw new Error('올바른 추천 형식의 응답을 받지 못했습니다.');
            }
            
        } catch (error) {
            showToast(`주제 추천 실패: ${error.message}`, 'error');
        } finally {
            hideLoading();
        }
    });

    renderRubricList();
}

function renderRubricList() {
    const container = document.getElementById('rubric-list-container');
    
    if (state.rubrics.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i data-lucide="info"></i>
                <p>지문과 주제를 입력한 후 <strong>'AI 평가 기준 자동 생성'</strong> 버튼을 클릭하거나, 직접 <strong>'항목 추가'</strong> 버튼을 눌러 평가 기준을 설정해 주세요.</p>
            </div>
        `;
        lucide.createIcons();
        updateRubricSummary();
        return;
    }
    
    container.innerHTML = '';
    state.rubrics.forEach(rubric => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'rubric-item';
        itemDiv.dataset.id = rubric.id;
        
        itemDiv.innerHTML = `
            <div class="rubric-item-header">
                <input type="text" class="rubric-input-title" value="${rubric.title}" placeholder="평가 영역명">
                <input type="number" class="rubric-input-score" value="${rubric.maxScore}" min="1" max="100" placeholder="배점">
                <button class="rubric-item-delete-btn" title="삭제">
                    <i data-lucide="trash"></i>
                </button>
            </div>
            <textarea class="rubric-input-desc" rows="2" placeholder="채점 세부 기준 설명">${rubric.description}</textarea>
        `;
        
        // Bind event listeners to input elements in rubric list
        const titleInput = itemDiv.querySelector('.rubric-input-title');
        const scoreInput = itemDiv.querySelector('.rubric-input-score');
        const descTextarea = itemDiv.querySelector('.rubric-input-desc');
        const deleteBtn = itemDiv.querySelector('.rubric-item-delete-btn');
        
        titleInput.addEventListener('input', () => {
            rubric.title = titleInput.value.trim();
            saveStateToStorage();
        });
        
        scoreInput.addEventListener('input', () => {
            rubric.maxScore = Number(scoreInput.value) || 0;
            saveStateToStorage();
            updateRubricSummary();
        });
        
        descTextarea.addEventListener('input', () => {
            rubric.description = descTextarea.value.trim();
            saveStateToStorage();
        });
        
        deleteBtn.addEventListener('click', () => {
            state.rubrics = state.rubrics.filter(r => r.id !== rubric.id);
            saveStateToStorage();
            renderRubricList();
        });
        
        container.appendChild(itemDiv);
    });
    
    lucide.createIcons();
    updateRubricSummary();
}

function updateRubricSummary() {
    const totalScore = state.rubrics.reduce((sum, item) => sum + item.maxScore, 0);
    document.getElementById('total-score-display').textContent = totalScore;
    
    const warningMsg = document.getElementById('score-warning-msg');
    if (state.rubrics.length > 0 && totalScore !== 100) {
        warningMsg.style.display = 'flex';
    } else {
        warningMsg.style.display = 'none';
    }
}

// --- 과제 보관함 (Assignment Library) ---
// 설계한 과제(지문·논제·루브릭)를 이 브라우저에 저장해두고 다시 불러올 수 있습니다.
function renderAssignmentLibrary() {
    const select = document.getElementById('assignment-library-select');
    if (!select) return;

    if (!state.assignmentLibrary || state.assignmentLibrary.length === 0) {
        select.innerHTML = '<option value="">저장된 과제가 없습니다</option>';
        return;
    }

    select.innerHTML = '';
    // 최신 저장이 위로 오도록 역순 표시
    state.assignmentLibrary.slice().reverse().forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.id;
        const title = (item.assignment && item.assignment.title) ? item.assignment.title : '(제목 없음)';
        opt.textContent = `${item.savedAt} · ${title.slice(0, 20)}`;
        select.appendChild(opt);
    });
}

function setupAssignmentLibraryHandlers() {
    const select = document.getElementById('assignment-library-select');
    if (!select) return;

    const btnSave = document.getElementById('btn-save-assignment');
    const btnLoad = document.getElementById('btn-load-assignment');
    const btnDelete = document.getElementById('btn-delete-assignment');
    const btnNew = document.getElementById('btn-new-assignment');

    const titleInput = document.getElementById('assignment-title');
    const passageInput = document.getElementById('assignment-passage');
    const topicInput = document.getElementById('assignment-topic');
    const minCharInput = document.getElementById('min-char-count');
    const maxCharInput = document.getElementById('max-char-count');

    const shortStamp = () => {
        const d = new Date();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        return `${mm}/${dd} ${hh}:${mi}`;
    };

    const applyAssignmentToUI = () => {
        if (titleInput) titleInput.value = state.assignment.title || '';
        if (passageInput) passageInput.value = state.assignment.passage || '';
        if (topicInput) topicInput.value = state.assignment.topic || '';
        if (minCharInput) minCharInput.value = (state.assignment.minChar !== undefined ? state.assignment.minChar : 400);
        if (maxCharInput) maxCharInput.value = (state.assignment.maxChar !== undefined ? state.assignment.maxChar : 800);
        renderRubricList();
    };

    renderAssignmentLibrary();

    // 현재 과제 저장
    if (btnSave) btnSave.addEventListener('click', () => {
        if (!state.assignment.title && !state.assignment.topic) {
            showToast('저장할 과제 제목이나 논제를 먼저 입력해 주세요.', 'error');
            return;
        }
        state.assignmentLibrary.push({
            id: 'asg-' + Date.now(),
            savedAt: shortStamp(),
            assignment: JSON.parse(JSON.stringify(state.assignment)),
            rubrics: JSON.parse(JSON.stringify(state.rubrics))
        });
        saveStateToStorage();
        renderAssignmentLibrary();
        showToast('현재 과제가 보관함에 저장되었습니다.', 'success');
    });

    // 선택한 과제 불러오기
    if (btnLoad) btnLoad.addEventListener('click', () => {
        const id = select.value;
        if (!id) { showToast('불러올 과제를 목록에서 선택해 주세요.', 'error'); return; }
        const entry = state.assignmentLibrary.find(a => a.id === id);
        if (!entry) { showToast('선택한 과제를 찾을 수 없습니다.', 'error'); return; }

        state.assignment = JSON.parse(JSON.stringify(entry.assignment));
        state.rubrics = JSON.parse(JSON.stringify(entry.rubrics || []));
        saveStateToStorage();
        applyAssignmentToUI();
        showToast('선택한 과제를 불러왔습니다. 필요하면 수정 후 공유 링크를 다시 만들어 주세요.', 'success');
    });

    // 선택한 과제 삭제
    if (btnDelete) btnDelete.addEventListener('click', () => {
        const id = select.value;
        if (!id) { showToast('삭제할 과제를 목록에서 선택해 주세요.', 'error'); return; }
        if (!confirm('선택한 과제를 보관함에서 삭제할까요? (학생 제출 기록에는 영향 없습니다)')) return;
        state.assignmentLibrary = state.assignmentLibrary.filter(a => a.id !== id);
        saveStateToStorage();
        renderAssignmentLibrary();
        showToast('보관함에서 삭제되었습니다.', 'info');
    });

    // 새 과제 시작 (입력값 비우기)
    if (btnNew) btnNew.addEventListener('click', () => {
        if (!confirm('현재 입력한 과제 내용을 비우고 새 과제를 시작할까요? (저장하지 않은 내용은 사라집니다)')) return;
        state.assignment = { title: '', passage: '', topic: '', minChar: 400, maxChar: 800 };
        state.rubrics = [];
        saveStateToStorage();
        applyAssignmentToUI();
        showToast('새 과제를 시작합니다. 지문과 논제를 입력해 주세요.', 'info');
    });
}

// --- Student View Logic ---
function renderStudentView() {
    // Populate assignment details
    document.getElementById('student-view-title').textContent = state.assignment.title || '국어 글쓰기 과제';
    document.getElementById('student-view-topic').innerHTML = state.assignment.topic 
        ? state.assignment.topic.replace(/\n/g, '<br>')
        : '<span class="text-muted">교사 모드에서 글쓰기 주제를 등록하면 여기에 나타납니다.</span>';
    
    const passageWrapper = document.getElementById('student-passage-wrapper');
    const passageContent = document.getElementById('student-view-passage');
    
    if (state.assignment.passage) {
        passageContent.innerHTML = state.assignment.passage.replace(/\n/g, '<br>');
        passageWrapper.style.display = 'block';
    } else {
        passageWrapper.style.display = 'none';
    }
    
    // Set up writing character counter
    const textarea = document.getElementById('student-writing-textarea');
    updateCharCounter(textarea.value);
}

function updateCharCounter(text) {
    const withSpace = text.length;
    const noSpace = text.replace(/\s/g, '').length;
    
    document.getElementById('char-count-with-space').textContent = withSpace;
    document.getElementById('char-count-no-space').textContent = noSpace;
    
    const statusBadge = document.getElementById('char-count-status');
    const min = state.assignment.minChar || 0;
    const max = state.assignment.maxChar || 99999;
    
    if (withSpace < min) {
        statusBadge.className = 'badge red';
        statusBadge.textContent = '글자수 미달';
    } else if (withSpace > max) {
        statusBadge.className = 'badge red';
        statusBadge.textContent = '글자수 초과';
    } else {
        statusBadge.className = 'badge green';
        statusBadge.textContent = '글자수 적절';
    }
}

function setupStudentViewHandlers() {
    const textarea = document.getElementById('student-writing-textarea');
    const btnSubmit = document.getElementById('btn-submit-writing');
    
    // 학생 학적 정보 입력 바인딩 및 자동 저장
    const gradeSelect = document.getElementById('student-grade');
    const classInput = document.getElementById('student-class');
    const numberInput = document.getElementById('student-number');
    const nameInput = document.getElementById('student-name');
    
    if (gradeSelect) {
        gradeSelect.addEventListener('change', () => {
            state.studentInfo.grade = gradeSelect.value;
            saveStateToStorage();
        });
    }
    if (classInput) {
        classInput.addEventListener('input', () => {
            state.studentInfo.class = classInput.value.trim();
            saveStateToStorage();
        });
    }
    if (numberInput) {
        numberInput.addEventListener('input', () => {
            state.studentInfo.number = numberInput.value.trim();
            saveStateToStorage();
        });
    }
    if (nameInput) {
        nameInput.addEventListener('input', () => {
            state.studentInfo.name = nameInput.value.trim();
            saveStateToStorage();
        });
    }
    
    textarea.addEventListener('input', () => {
        updateCharCounter(textarea.value);
    });
    
    btnSubmit.addEventListener('click', async () => {
        const studentText = textarea.value.trim();
        
        // 학적 정보 유효성 검사
        const gradeVal = gradeSelect ? gradeSelect.value : '';
        const classVal = classInput ? classInput.value.trim() : '';
        const numberVal = numberInput ? numberInput.value.trim() : '';
        const nameVal = nameInput ? nameInput.value.trim() : '';
        
        if (!gradeVal || !classVal || !numberVal || !nameVal) {
            showToast('학년, 반, 번호, 이름을 모두 입력해 주세요.', 'error');
            return;
        }
        
        // 최종 정보 갱신 및 저장
        state.studentInfo = { grade: gradeVal, class: classVal, number: numberVal, name: nameVal };
        saveStateToStorage();
        
        if (!studentText) {
            showToast('글을 작성한 후 제출해 주세요.', 'error');
            return;
        }
        
        if (state.rubrics.length === 0) {
            showToast('설정된 채점 기준이 없습니다. 교사 모드에서 기준을 먼저 만드세요.', 'error');
            return;
        }
        
        if (!state.apiKey) {
            showToast('Gemini API Key가 필요합니다. [설정 & API] 탭을 확인하세요.', 'error');
            return;
        }
        
        showLoading('AI 채점 및 피드백 생성 중...', '설정된 루브릭 항목별로 문장 구성과 내용을 분석하여 점수를 계산하고 보완할 점을 작성하고 있습니다.');
        
        // Build Rubric string for prompt
        const rubricPromptString = state.rubrics.map(r => 
            `- [영역 ID: ${r.id}] ${r.title} (배점: ${r.maxScore}점): ${r.description}`
        ).join('\n');
        
        const prompt = `
당신은 고등학교 국어 교사이며 서술형 평가의 전문 채점관입니다.
아래 제공된 [읽기 지문], [글쓰기 논제 및 요구사항], 그리고 교사가 설정한 [채점 기준(루브릭)]을 엄격하게 대조하여 [학생이 작성한 글]을 객관적으로 채점하고 피드백해 주십시오.

[읽기 지문]:
${state.assignment.passage}

[글쓰기 논제 및 요구사항]:
${state.assignment.topic}

[채점 기준(루브릭)]:
${rubricPromptString}

[학생이 작성한 글]:
${studentText}

---

평가 진행 시 유의 사항:
1. 각 영역 ID별로 부여할 획득 점수(정수)를 결정하십시오. 절대로 배점(maxScore)을 초과해서는 안 되며, 학생 글의 상태에 따라 엄격하고 정밀하게 채점하십시오. 이때 2022 개정 교육과정 성취평가제의 관점에서 해당 영역의 성취기준 도달 정도(A: 매우 우수 90%↑, B: 우수 80%↑, C: 보통 70%↑, D: 기초 60%↑, E: 노력 요함 60%미만)를 판단하고, 그 도달 수준이 점수에 자연스럽게 반영되도록 채점하십시오.
2. 학생이 쓴 문장 중 맞춤법이 틀렸거나, 부적절한 표현, 비문, 혹은 논리적으로 모순되거나 보완해야 할 문장을 최대 3개 선별하여 'before'와 'after'의 교정 예시 및 구체적인 'comment'를 기술해 주십시오. (만약 교정할 문장이 없다면 빈 리스트로 출력하십시오.)
3. 학생의 글에 대해 칭찬할 만한 '강점(strengths)'과 아쉽거나 논거가 부족해 보완해야 하는 '약점(weaknesses)'을 국어 선생님의 친근하고 전문적인 어투(~합니다, ~를 보완하면 좋겠습니다 등)로 한 문단씩 적어주십시오.
4. 해당 논제와 지문에 맞추어 가장 훌륭하게 작성된 '모범 답안 예시(modelEssay)'를 한 편(약 400~600자) 작성해 주십시오.

출력은 반드시 다른 부가 텍스트 없이 오직 하단의 JSON 형식을 엄격히 준수하여 응답해 주세요.

JSON Schema 형식:
\`\`\`json
{
  "scores": {
    "루브릭영역ID_1": 획득점수숫자,
    "루브릭영역ID_2": 획득점수숫자
  },
  "strengths": "잘 쓴 점에 대한 종합 피드백 텍스트",
  "weaknesses": "부족한 점과 보완해야 할 방향에 대한 종합 피드백 텍스트",
  "revisions": [
    {
      "before": "오류나 어색한 부분이 있는 학생의 원래 문장",
      "after": "선생님이 올바르고 격조 있게 교정한 문장",
      "comment": "이 문장을 어떻게, 왜 수정했는지 친절히 설명하는 글"
    }
  ],
  "modelEssay": "해당 과제의 출제 의도를 완벽히 만족하는 모범 글짓기 답안"
}
\`\`\`
`;

        try {
            const aiFeedback = await callGemini(prompt, true);
            
            // Validate score structure and create record
            const newResult = {
                id: 'res-' + Date.now(),
                timestamp: new Date().toLocaleString('ko-KR'),
                assignmentTitle: state.assignment.title || '국어 글쓰기 과제',
                assignmentTopic: state.assignment.topic,
                studentText: studentText,
                studentInfo: {
                    grade: state.studentInfo.grade,
                    class: state.studentInfo.class,
                    number: state.studentInfo.number,
                    name: state.studentInfo.name
                },
                scores: aiFeedback.scores || {},
                strengths: aiFeedback.strengths || '무난하게 작성되었습니다.',
                weaknesses: aiFeedback.weaknesses || '특별한 약점이 없습니다.',
                revisions: aiFeedback.revisions || [],
                modelEssay: aiFeedback.modelEssay || '모범 답안을 불러올 수 없습니다.',
                rubricsSnapshot: JSON.parse(JSON.stringify(state.rubrics)) // Deep copy rubrics as snapshot at evaluation time
            };
            
            // Save result to state
            state.results.unshift(newResult); // Add to the beginning of the array
            state.currentResultId = newResult.id;
            saveStateToStorage();
            
            // 구글 스프레드시트 연동이 되어 있다면 데이터 전송 (백그라운드 실행)
            if (state.sheetUrl) {
                sendDataToGoogleSheets(newResult, studentText);
            }
            
            // Move to results tab
            document.querySelector('[data-tab="results"]').click();
            showToast('채점이 완료되었습니다. 피드백 리포트를 확인하세요!', 'success');
            
        } catch (error) {
            showToast(`채점 중 오류가 발생했습니다: ${error.message}`, 'error');
        } finally {
            hideLoading();
        }
    });
}

// --- 성취수준 판정 (2022 개정 교육과정 성취평가제 5단계) ---
// 성취율(획득점수 / 배점 × 100)을 기준으로 A~E 등급을 산출합니다.
//  A: 90% 이상, B: 80% 이상, C: 70% 이상, D: 60% 이상, E: 60% 미만
function getAchievementLevel(percentage) {
    if (percentage >= 90) return { level: 'A', label: '매우 우수' };
    if (percentage >= 80) return { level: 'B', label: '우수' };
    if (percentage >= 70) return { level: 'C', label: '보통' };
    if (percentage >= 60) return { level: 'D', label: '기초' };
    return { level: 'E', label: '노력 요함' };
}

// 총 획득점수/총 배점으로 종합 성취수준을 계산 (배점 합이 0이면 E 처리)
function computeOverallAchievement(totalAcquired, totalMax) {
    const pct = totalMax > 0 ? (totalAcquired / totalMax) * 100 : 0;
    const info = getAchievementLevel(pct);
    return { ...info, percentage: Math.round(pct) };
}

// '이전 평가 기록' 드롭다운에 표시할 라벨 ('MM/DD HH:mm · 제목' 형식).
// 제출 시각은 결과 id(res-<밀리초>)에서 복원하고, 실패 시 저장된 timestamp 문자열을 그대로 사용.
function formatResultLabel(res) {
    let stamp = res.timestamp || '';
    const ms = Number(String(res.id || '').replace('res-', ''));
    if (!isNaN(ms) && ms > 0) {
        const d = new Date(ms);
        if (!isNaN(d.getTime())) {
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const hh = String(d.getHours()).padStart(2, '0');
            const mi = String(d.getMinutes()).padStart(2, '0');
            stamp = `${mm}/${dd} ${hh}:${mi}`;
        }
    }
    const title = (res.assignmentTitle || '평가 기록').slice(0, 14);
    return `${stamp} · ${title}`;
}

// --- Results & Feedback View Logic ---
function renderResultsView() {
    const emptyState = document.getElementById('results-empty-state');
    const contentArea = document.getElementById('results-content-area');
    const historyWrapper = document.getElementById('result-history-selector-wrapper');
    const historySelect = document.getElementById('result-history-select');
    
    if (state.results.length === 0) {
        emptyState.style.display = 'flex';
        contentArea.style.display = 'none';
        historyWrapper.style.display = 'none';
        return;
    }
    
    emptyState.style.display = 'none';
    contentArea.style.display = 'grid';
    historyWrapper.style.display = 'flex';
    
    // Update history dropdown selector
    historySelect.innerHTML = '';
    state.results.forEach(res => {
        const option = document.createElement('option');
        option.value = res.id;
        option.textContent = formatResultLabel(res);
        if (res.id === state.currentResultId) {
            option.selected = true;
        }
        historySelect.appendChild(option);
    });
    
    // Get currently selected result details
    const currentRes = state.results.find(res => res.id === state.currentResultId);
    if (!currentRes) return;
    
    // Compute scores
    let totalAcquired = 0;
    let totalMax = 0;
    
    const scoreBarsContainer = document.getElementById('score-bars-container');
    scoreBarsContainer.innerHTML = '';
    
    currentRes.rubricsSnapshot.forEach(rubric => {
        const score = currentRes.scores[rubric.id] !== undefined ? currentRes.scores[rubric.id] : 0;
        totalAcquired += score;
        totalMax += rubric.maxScore;
        
        const percentage = rubric.maxScore > 0 ? (score / rubric.maxScore) * 100 : 0;
        
        const barItem = document.createElement('div');
        barItem.className = 'score-bar-item';
        barItem.innerHTML = `
            <div class="score-bar-info">
                <span class="score-bar-name">${rubric.title}</span>
                <span class="score-bar-values">${score} / ${rubric.maxScore}점 · <strong>${getAchievementLevel(percentage).level}</strong></span>
            </div>
            <div class="score-bar-track">
                <div class="score-bar-fill" style="width: 0%"></div>
            </div>
            <div class="score-bar-desc">${rubric.description}</div>
        `;
        scoreBarsContainer.appendChild(barItem);
        
        // Trigger transition
        setTimeout(() => {
            const fill = barItem.querySelector('.score-bar-fill');
            if (fill) fill.style.width = `${percentage}%`;
        }, 100);
    });
    
    // Update Total Score Display
    document.getElementById('total-score-value').textContent = totalAcquired;
    document.getElementById('total-score-max').textContent = totalMax;

    // Update Overall Achievement Level (성취수준 A~E)
    const overall = computeOverallAchievement(totalAcquired, totalMax);
    const badgeEl = document.getElementById('achievement-level-badge');
    if (badgeEl) {
        badgeEl.textContent = `성취수준 ${overall.level} · ${overall.label} (${overall.percentage}%)`;
        badgeEl.className = `achievement-badge level-${overall.level}`;
    }
    
    // Update Strengths and Weaknesses texts
    document.getElementById('feedback-strengths').textContent = currentRes.strengths;
    document.getElementById('feedback-weaknesses').textContent = currentRes.weaknesses;
    
    // Update Student Original Text
    document.getElementById('result-student-writing').innerHTML = currentRes.studentText.replace(/\n/g, '<br>');
    
    // Update Sentence Revisions
    const revisionsContainer = document.getElementById('revision-sentences-container');
    revisionsContainer.innerHTML = '';
    
    if (currentRes.revisions && currentRes.revisions.length > 0) {
        currentRes.revisions.forEach(rev => {
            const revDiv = document.createElement('div');
            revDiv.className = 'revision-item';
            revDiv.innerHTML = `
                <div class="revision-before">
                    <i data-lucide="x-circle"></i>
                    <span><strong>이전:</strong> ${rev.before}</span>
                </div>
                <div class="revision-after">
                    <i data-lucide="check-circle-2"></i>
                    <span><strong>이후:</strong> ${rev.after}</span>
                </div>
                <div class="revision-comment">
                    💡 <strong>첨삭 지도:</strong> ${rev.comment}
                </div>
            `;
            revisionsContainer.appendChild(revDiv);
        });
    } else {
        revisionsContainer.innerHTML = `
            <div class="rich-text-box">
                선생님이 교정할 특별한 맞춤법 오류나 어법상 어색한 문장이 없습니다. 훌륭한 글솜씨입니다!
            </div>
        `;
    }
    
    // Update Model Essay
    document.getElementById('result-model-essay').innerHTML = currentRes.modelEssay.replace(/\n/g, '<br>');
    
    lucide.createIcons();
}

function setupResultsViewHandlers() {
    const historySelect = document.getElementById('result-history-select');
    const btnCopy = document.getElementById('btn-copy-result');
    const btnDownload = document.getElementById('btn-download-result');
    
    // Switch between historical records
    historySelect.addEventListener('change', (e) => {
        state.currentResultId = e.target.value;
        renderResultsView();
    });
    
    // Copy result report for school records (NEIS)
    btnCopy.addEventListener('click', () => {
        const currentRes = state.results.find(res => res.id === state.currentResultId);
        if (!currentRes) return;
        
        let totalAcquired = 0;
        let totalMax = 0;
        let rubricsText = '';
        
        currentRes.rubricsSnapshot.forEach(rubric => {
            const score = currentRes.scores[rubric.id] || 0;
            totalAcquired += score;
            totalMax += rubric.maxScore;
            rubricsText += `- ${rubric.title}: ${score}/${rubric.maxScore}점\n`;
        });
        
        const ach = computeOverallAchievement(totalAcquired, totalMax);
        const info = currentRes.studentInfo || {};
        const studentMeta = info.name ? `${info.grade || '-'}학년 ${info.class || '-'}반 ${info.number || '-'}번 ${info.name}` : '학생 정보 없음';

        const copyText = `[국어 글쓰기 AI 평가 결과]\n` +
            `과제명: ${currentRes.assignmentTitle}\n` +
            `대상: ${studentMeta}\n` +
            `일시: ${currentRes.timestamp}\n\n` +
            `■ 종합 점수: ${totalAcquired}/${totalMax}점 (성취수준 ${ach.level} · ${ach.label})\n` +
            `${rubricsText}\n` +
            `■ 우수한 점(강점):\n${currentRes.strengths}\n\n` +
            `■ 보완할 점(약점):\n${currentRes.weaknesses}\n\n` +
            `■ 학생 글 원문:\n${currentRes.studentText}\n`;
            
        navigator.clipboard.writeText(copyText)
            .then(() => showToast('평가 결과 보고서가 클립보드에 복사되었습니다! NEIS 등에 바로 활용하세요.', 'success'))
            .catch(() => showToast('클립보드 복사에 실패했습니다.', 'error'));
    });
    
    // Download result as text file
    btnDownload.addEventListener('click', () => {
        const currentRes = state.results.find(res => res.id === state.currentResultId);
        if (!currentRes) return;
        
        let totalAcquired = 0;
        let totalMax = 0;
        let rubricsText = '';
        
        currentRes.rubricsSnapshot.forEach(rubric => {
            const score = currentRes.scores[rubric.id] || 0;
            totalAcquired += score;
            totalMax += rubric.maxScore;
            rubricsText += `- ${rubric.title} (${rubric.description}): ${score}/${rubric.maxScore}점\n`;
        });
        
        let revisionsText = '';
        if (currentRes.revisions && currentRes.revisions.length > 0) {
            currentRes.revisions.forEach((rev, idx) => {
                revisionsText += `${idx+1}. 이전: ${rev.before}\n   이후: ${rev.after}\n   첨삭: ${rev.comment}\n\n`;
            });
        } else {
            revisionsText = '수정 권장 문장 없음\n';
        }
        
        const ach = computeOverallAchievement(totalAcquired, totalMax);
        const info = currentRes.studentInfo || {};
        const studentMeta = info.name ? `${info.grade || '-'}학년 ${info.class || '-'}반 ${info.number || '-'}번 ${info.name}` : '학생 정보 없음';

        const content = `==================================================\n` +
            `          국어 작문 AI 평가 및 피드백 보고서\n` +
            `==================================================\n` +
            `과제명: ${currentRes.assignmentTitle}\n` +
            `대상 학생: ${studentMeta}\n` +
            `일시: ${currentRes.timestamp}\n\n` +
            `--------------------------------------------------\n` +
            `1. 종합 평가 결과: ${totalAcquired} / ${totalMax}점  (성취수준 ${ach.level} · ${ach.label}, ${ach.percentage}%)\n` +
            `--------------------------------------------------\n` +
            `${rubricsText}\n` +
            `--------------------------------------------------\n` +
            `2. 종합 피드백\n` +
            `--------------------------------------------------\n` +
            `[강점] \n${currentRes.strengths}\n\n` +
            `[약점 및 개선 방향] \n${currentRes.weaknesses}\n\n` +
            `--------------------------------------------------\n` +
            `3. 문장 교정 및 첨삭 지도\n` +
            `--------------------------------------------------\n` +
            `${revisionsText}` +
            `--------------------------------------------------\n` +
            `4. 모범 답안 예시\n` +
            `--------------------------------------------------\n` +
            `${currentRes.modelEssay}\n\n` +
            `--------------------------------------------------\n` +
            `5. 제출 글 원문\n` +
            `--------------------------------------------------\n` +
            `${currentRes.studentText}\n`;
            
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        
        // Clean filename: remove special chars
        const sanitizedTitle = currentRes.assignmentTitle.replace(/[^a-zA-Z0-9가-힣\s]/g, '');
        link.setAttribute('download', `국어평가_${sanitizedTitle}_${Date.now()}.txt`);
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        showToast('텍스트 보고서 파일 다운로드가 완료되었습니다.', 'success');
    });
    
    // Download result as Word file (.doc)
    const btnDownloadWord = document.getElementById('btn-download-word');
    if (btnDownloadWord) {
        btnDownloadWord.addEventListener('click', () => {
            const currentRes = state.results.find(res => res.id === state.currentResultId);
            if (!currentRes) return;
            downloadResultAsWord(currentRes);
        });
    }
}

// URL 파라미터 체크하여 교사 모드 여부에 따라 사이드바 탭 제어
function checkTeacherModeAndSetupSidebar() {
    const urlParams = new URLSearchParams(window.location.search);
    const isTeacherModeUrl = urlParams.get('mode') === 'teacher';
    
    // 교사 전용 탭 (설정 & 교사모드 설계 & 제출 현황)
    const teacherNavItems = document.querySelectorAll('.nav-item[data-tab="config"], .nav-item[data-tab="teacher"], #nav-item-submissions');
    
    if (!isTeacherModeUrl) {
        // 교사 모드가 아닐 때 (학생 접속) -> 탭 버튼 숨김
        teacherNavItems.forEach(item => {
            item.style.display = 'none';
        });
        
        // 현재 active된 탭이 교사용 탭(config 등)이라면 student 탭으로 활성화 탭을 강제 이전
        const activeNavItem = document.querySelector('.nav-item.active');
        const activeTab = activeNavItem ? activeNavItem.getAttribute('data-tab') : '';
        if (activeTab === 'config' || activeTab === 'teacher' || activeTab === 'submissions') {
            const studentNavItem = document.querySelector('.nav-item[data-tab="student"]');
            if (studentNavItem) {
                const navItems = document.querySelectorAll('.nav-item');
                const tabPanels = document.querySelectorAll('.tab-panel');
                
                navItems.forEach(nav => nav.classList.remove('active'));
                tabPanels.forEach(panel => panel.classList.remove('active'));
                
                studentNavItem.classList.add('active');
                document.getElementById('tab-student').classList.add('active');
                renderStudentView();
            }
        }
    } else {
        // 교사 모드일 때 -> 교사 전용 탭(설정/교사모드/제출현황)만 표시
        teacherNavItems.forEach(item => {
            item.style.display = 'flex';
        });
        // 학생용 화면(학생 모드 작문 / 평가 결과)은 사이드바에서 숨김.
        // → 교사 모드 상단의 '학생 화면 바로가기' 드롭다운으로만 진입하도록 하여 혼동을 줄임.
        document.querySelectorAll('.nav-item[data-tab="student"], .nav-item[data-tab="results"]').forEach(item => {
            item.style.display = 'none';
        });
    }
}

// 교사 모드 상단 '학생 화면 바로가기' 드롭다운 핸들러
// 학생 모드/평가 결과 탭은 교사 사이드바에서 숨겨져 있으므로, 이 드롭다운이 유일한 진입점입니다.
function setupTeacherGotoDropdown() {
    const gotoSelect = document.getElementById('teacher-goto-student');
    if (!gotoSelect) return;

    gotoSelect.addEventListener('change', () => {
        const target = gotoSelect.value;
        if (!target) return;

        // 사이드바 활성 표시 초기화 후 대상 패널만 활성화 (해당 탭 버튼은 교사 모드에서 숨김 상태)
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));

        const targetPanel = document.getElementById(`tab-${target}`);
        if (targetPanel) targetPanel.classList.add('active');

        if (target === 'student') {
            renderStudentView();
        } else if (target === 'results') {
            renderResultsView();
        }

        // 드롭다운을 기본값으로 되돌려 다시 선택할 수 있게 함
        gotoSelect.value = '';
    });
}

// 교사 비밀번호 관리 핸들러
function setupTeacherPasswordHandlers() {
    const pwInput = document.getElementById('teacher-password-input');
    const btnToggle = document.getElementById('btn-toggle-password-visibility');
    const btnSave = document.getElementById('btn-save-teacher-password');
    
    if (!pwInput || !btnToggle || !btnSave) return;
    
    // UI에 기존 저장된 패스워드 표시
    pwInput.value = state.teacherPassword;
    
    // 비밀번호 보이기/숨기기 토글
    btnToggle.addEventListener('click', () => {
        const icon = btnToggle.querySelector('i');
        if (pwInput.type === 'password') {
            pwInput.type = 'text';
            icon.setAttribute('data-lucide', 'eye-off');
        } else {
            pwInput.type = 'password';
            icon.setAttribute('data-lucide', 'eye');
        }
        lucide.createIcons();
    });
    
    // 비밀번호 저장
    btnSave.addEventListener('click', () => {
        const newPw = pwInput.value.trim();
        if (!newPw) {
            showToast('비밀번호를 입력해 주세요.', 'error');
            return;
        }
        
        state.teacherPassword = newPw;
        saveStateToStorage();
        showToast('교사 비밀번호가 성공적으로 저장되었습니다!', 'success');
    });
}

// --- UTF-8 Safe Base64 Encoding & Decoding Helpers ---
function utf8ToBase64(str) {
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => {
        return String.fromCharCode(parseInt(p1, 16));
    }));
}

function base64ToUtf8(str) {
    return decodeURIComponent(atob(str).split('').map((c) => {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
}

// --- URL Share Link Handler ---
function checkAndLoadSharedData() {
    const urlParams = new URLSearchParams(window.location.search);
    const encodedData = urlParams.get('data');
    
    if (encodedData) {
        try {
            const decodedJson = base64ToUtf8(encodedData);
            const sharedState = JSON.parse(decodedJson);
            
            if (sharedState.assignment && sharedState.rubrics) {
                // Update local storage and state
                if (sharedState.includeApiKey && sharedState.apiKey) {
                    state.apiKey = sharedState.apiKey;
                    localStorage.setItem(STORAGE_KEYS.API_KEY, state.apiKey);
                }
                
                if (sharedState.sheetUrl) {
                    state.sheetUrl = sharedState.sheetUrl;
                    localStorage.setItem(STORAGE_KEYS.SHEET_URL, state.sheetUrl);
                }

                if (sharedState.selectedModel) {
                    state.selectedModel = sharedState.selectedModel;
                    localStorage.setItem(STORAGE_KEYS.SELECTED_MODEL, state.selectedModel);
                }
                
                state.assignment = sharedState.assignment;
                state.rubrics = sharedState.rubrics;
                
                localStorage.setItem(STORAGE_KEYS.ASSIGNMENT, JSON.stringify(state.assignment));
                localStorage.setItem(STORAGE_KEYS.RUBRICS, JSON.stringify(state.rubrics));
                
                // Clean URL data parameter so the URL stays clean, preserving others (e.g. mode)
                const cleanUrlParams = new URLSearchParams(window.location.search);
                cleanUrlParams.delete('data');
                const newSearch = cleanUrlParams.toString();
                const newUrl = window.location.origin + window.location.pathname + (newSearch ? '?' + newSearch : '');
                window.history.replaceState({ path: newUrl }, '', newUrl);
                
                // Show success toast
                setTimeout(() => {
                    showToast('공유받은 과제와 평가 기준이 정상적으로 적용되었습니다!', 'success');
                }, 500);
                
                // Sync to DOM elements if they exist
                const titleInput = document.getElementById('assignment-title');
                const passageInput = document.getElementById('assignment-passage');
                const topicInput = document.getElementById('assignment-topic');
                const minCharInput = document.getElementById('min-char-count');
                const maxCharInput = document.getElementById('max-char-count');
                const keyInput = document.getElementById('api-key-input');
                
                if (titleInput) titleInput.value = state.assignment.title;
                if (passageInput) passageInput.value = state.assignment.passage;
                if (topicInput) topicInput.value = state.assignment.topic;
                if (minCharInput) minCharInput.value = state.assignment.minChar;
                if (maxCharInput) maxCharInput.value = state.assignment.maxChar;
                if (keyInput && state.apiKey) keyInput.value = state.apiKey;
            }
        } catch (e) {
            console.error('Failed to parse shared link data:', e);
            showToast('공유 링크 데이터를 불러오는 데 실패했습니다.', 'error');
        }
    }
}

// --- Share Link Handler for Teacher ---
function setupShareLinkHandlers() {
    const btnGen = document.getElementById('btn-generate-share-link');
    const btnCopy = document.getElementById('btn-copy-share-link');
    const linkInput = document.getElementById('share-link-input');
    const checkApiKey = document.getElementById('share-include-api-key');
    const apiWarning = document.getElementById('share-api-warning');
    
    if (!btnGen || !btnCopy || !linkInput) return;
    
    // Toggle warning message based on checkbox
    checkApiKey.addEventListener('change', () => {
        if (checkApiKey.checked) {
            apiWarning.style.display = 'flex';
        } else {
            apiWarning.style.display = 'none';
        }
    });
    
    btnGen.addEventListener('click', () => {
        if (!state.assignment.title && !state.assignment.topic) {
            showToast('공유할 과제 제목이나 주제가 등록되어 있지 않습니다.', 'error');
            return;
        }
        
        // Prepare shared data
        const sharedState = {
            assignment: state.assignment,
            rubrics: state.rubrics,
            includeApiKey: checkApiKey.checked,
            sheetUrl: state.sheetUrl,
            selectedModel: state.selectedModel // 교사가 검증한 작동 모델을 학생에게 전달
        };
        
        if (checkApiKey.checked) {
            if (!state.apiKey) {
                showToast('포함할 API Key가 등록되어 있지 않습니다. 설정 & API 탭에서 등록해 주세요.', 'error');
                return;
            }
            sharedState.apiKey = state.apiKey;
        }
        
        try {
            // Serialize and encode to base64
            const jsonStr = JSON.stringify(sharedState);
            const encodedData = utf8ToBase64(jsonStr);
            
            // Construct student-mode URL
            const baseUrl = window.location.origin + window.location.pathname;
            const shareUrl = `${baseUrl}?data=${encodeURIComponent(encodedData)}`;
            
            linkInput.value = shareUrl;
            btnCopy.style.display = 'flex';
            
            showToast('공유 링크가 생성되었습니다. 아래의 복사 버튼을 눌러 공유해 주세요!', 'success');
        } catch (err) {
            console.error('Failed to generate share link:', err);
            showToast('공유 링크 생성에 실패했습니다.', 'error');
        }
    });
    
    btnCopy.addEventListener('click', () => {
        if (!linkInput.value) return;
        
        navigator.clipboard.writeText(linkInput.value)
            .then(() => {
                showToast('학생용 공유 링크가 클립보드에 복사되었습니다!', 'success');
            })
            .catch(() => {
                showToast('클립보드 복사에 실패했습니다. 주소를 직접 선택해서 복사해 주세요.', 'error');
            });
    });
}

// --- Google Sheets Transmission & Submission Dashboard Logic ---

// 구글 스프레드시트로 학생 작문 데이터 전송
async function sendDataToGoogleSheets(result, studentText) {
    if (!state.sheetUrl) return;
    
    // 개별 영역 점수 텍스트 포맷팅
    let scoreDetails = [];
    result.rubricsSnapshot.forEach(rubric => {
        const score = result.scores[rubric.id] || 0;
        scoreDetails.push(`${rubric.title}: ${score}/${rubric.maxScore}점`);
    });
    const scoresText = scoreDetails.join('\n');
    
    // 문장 첨삭 교정 내역 문자열 포맷팅
    let revisionsText = '';
    if (result.revisions && result.revisions.length > 0) {
        result.revisions.forEach((rev, idx) => {
            revisionsText += `[문장 ${idx+1}] 이전: ${rev.before} | 이후: ${rev.after} | 첨삭: ${rev.comment}\n`;
        });
    } else {
        revisionsText = '없음';
    }
    
    // 글자 수 포맷팅
    const charCount = `공백포함 ${studentText.length}자 / 공백제외 ${studentText.replace(/\s/g, '').length}자`;
    
    // 총 획득 점수 및 성취수준 계산
    let totalAcquired = 0;
    let totalMax = 0;
    result.rubricsSnapshot.forEach(rubric => {
        totalAcquired += (result.scores[rubric.id] || 0);
        totalMax += rubric.maxScore;
    });
    const achievement = computeOverallAchievement(totalAcquired, totalMax);

    const postData = {
        timestamp: result.timestamp,
        grade: result.studentInfo?.grade ? `${result.studentInfo.grade}학년` : '-',
        class: result.studentInfo?.class ? `${result.studentInfo.class}반` : '-',
        number: result.studentInfo?.number ? `${result.studentInfo.number}번` : '-',
        name: result.studentInfo?.name || '-',
        assignmentTitle: result.assignmentTitle,
        charCount: charCount,
        totalScore: totalAcquired,
        achievementLevel: `${achievement.level} (${achievement.label})`,
        scoresText: scoresText,
        strengths: result.strengths,
        weaknesses: result.weaknesses,
        revisionsText: revisionsText,
        modelEssay: result.modelEssay,
        studentText: result.studentText
    };
    
    try {
        await fetch(state.sheetUrl, {
            method: 'POST',
            body: JSON.stringify(postData),
            mode: 'no-cors' // CORS 리다이렉트 예외 무시 전송 보장
        });
        showToast('과제가 구글 스프레드시트에 제출되었습니다.', 'success');
    } catch (err) {
        console.error('Failed to submit writing to Google Sheet:', err);
    }
}

// 구글 스프레드시트에서 학생 제출 내역 로드
// Apps Script 웹앱 GET은 브라우저 CORS 정책상 fetch로 직접 읽으면 자주 차단되므로,
// CORS 제약이 없는 JSONP(<script> 태그 + callback 파라미터) 방식으로 불러옵니다.
function loadSubmissionsFromGoogleSheets() {
    if (!state.sheetUrl) {
        showToast('설정 탭에서 구글 스프레드시트 연동 URL을 먼저 등록해 주세요.', 'error');
        return;
    }

    showLoading('제출 현황 불러오는 중...', '구글 스프레드시트에서 실시간으로 학생들의 제출 리스트를 가져오는 중입니다.');

    const callbackName = 'kwaJsonp_' + Date.now();
    const script = document.createElement('script');
    let finished = false;
    let timer = null;

    const cleanup = () => {
        try { delete window[callbackName]; } catch (e) { window[callbackName] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
        if (timer) clearTimeout(timer);
    };

    const fail = (reason) => {
        if (finished) return;
        finished = true;
        cleanup();
        hideLoading();
        console.error('Failed to load submissions (JSONP):', reason);
        showToast('제출 내역 로드 실패. Apps Script 배포 시 "액세스: 모든 사용자"로 설정했는지, URL이 /exec로 끝나는지 확인하세요.', 'error');
    };

    // 스프레드시트에서 데이터가 도착하면 실행되는 전역 콜백
    window[callbackName] = (data) => {
        if (finished) return;
        finished = true;
        cleanup();
        hideLoading();

        if (data && Array.isArray(data)) {
            // 최신 제출이 맨 위로 오도록 역순 배치
            state.submissions = data.reverse();
            updateClassFilterOptions();
            updateAssignmentFilterOptions();
            renderSubmissionsList();
            showToast('제출 현황이 최신 정보로 갱신되었습니다.', 'success');
        } else if (data && data.error) {
            showToast(`데이터 불러오기 실패: ${data.error}`, 'error');
        } else {
            state.submissions = [];
            renderSubmissionsList();
            showToast('스프레드시트에 아직 제출 내역이 없습니다.', 'info');
        }
    };

    // 15초 내 응답이 없으면 실패 처리
    timer = setTimeout(() => fail('시간 초과'), 15000);
    script.onerror = () => fail('스크립트 로드 오류');

    const sep = state.sheetUrl.includes('?') ? '&' : '?';
    script.src = `${state.sheetUrl}${sep}callback=${callbackName}&t=${Date.now()}`;
    document.body.appendChild(script);
}

// 제출 명단 학급 필터 구성
function updateClassFilterOptions() {
    const filterSelect = document.getElementById('filter-class');
    if (!filterSelect) return;
    
    const classes = new Set();
    state.submissions.forEach(sub => {
        if (sub.반) classes.add(sub.반.trim());
    });
    
    const sortedClasses = Array.from(classes).sort((a, b) => {
        const valA = parseInt(a) || 0;
        const valB = parseInt(b) || 0;
        return valA - valB;
    });
    
    filterSelect.innerHTML = '<option value="">전체 반</option>';
    sortedClasses.forEach(c => {
        const option = document.createElement('option');
        option.value = c;
        option.textContent = c;
        filterSelect.appendChild(option);
    });
}

// 제출 명단 과제명(주제) 필터 구성
function updateAssignmentFilterOptions() {
    const filterSelect = document.getElementById('filter-assignment');
    if (!filterSelect) return;

    const titles = new Set();
    state.submissions.forEach(sub => {
        if (sub.과제명 !== undefined && sub.과제명 !== null && String(sub.과제명).trim() !== '') {
            titles.add(String(sub.과제명).trim());
        }
    });

    const sortedTitles = Array.from(titles).sort();
    filterSelect.innerHTML = '<option value="">전체 과제</option>';
    sortedTitles.forEach(t => {
        const option = document.createElement('option');
        option.value = t;
        option.textContent = t.length > 24 ? t.slice(0, 24) + '…' : t;
        filterSelect.appendChild(option);
    });
}

// 제출 명단 테이블 렌더링
function renderSubmissionsList() {
    const listBody = document.getElementById('submissions-list-body');
    if (!listBody) return;

    const classFilter = document.getElementById('filter-class').value;
    const searchFilter = document.getElementById('search-student').value.trim().toLowerCase();
    const assignmentFilterEl = document.getElementById('filter-assignment');
    const assignmentFilter = assignmentFilterEl ? assignmentFilterEl.value : '';

    listBody.innerHTML = '';

    const filteredSubmissions = state.submissions.filter(sub => {
        const matchClass = !classFilter || (sub.반 && String(sub.반).trim() === classFilter);
        const matchSearch = !searchFilter || (sub.이름 && String(sub.이름).toLowerCase().includes(searchFilter));
        const matchAssignment = !assignmentFilter || (sub.과제명 && String(sub.과제명).trim() === assignmentFilter);
        return matchClass && matchSearch && matchAssignment;
    });
    
    if (filteredSubmissions.length === 0) {
        listBody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; padding: 40px; color: var(--text-secondary);">
                    제출된 명단이 없거나 검색 결과가 일치하지 않습니다.
                </td>
            </tr>
        `;
        return;
    }
    
    filteredSubmissions.forEach((sub, idx) => {
        const row = document.createElement('tr');
        row.style.cursor = 'pointer';
        row.style.borderBottom = '1px solid var(--border-color)';
        
        const isSelected = state.selectedSubmissionId === idx;
        if (isSelected) {
            row.style.backgroundColor = '#eef2ff';
        }
        
        row.addEventListener('mouseover', () => {
            if (!isSelected) row.style.backgroundColor = 'var(--bg-hover, #f8fafc)';
        });
        row.addEventListener('mouseout', () => {
            row.style.backgroundColor = isSelected ? '#eef2ff' : 'transparent';
        });
        
        row.innerHTML = `
            <td style="padding: 12px 16px;">${sub.학년 || '-'} ${sub.반 || '-'} ${sub.번호 || '-'}</td>
            <td style="padding: 12px 16px; font-weight: 600;">${sub.이름 || '-'}</td>
            <td style="padding: 12px 16px; font-weight: bold; color: var(--color-indigo, #6366f1);">${sub.총점 || '0'}점${sub.성취수준 ? ' · ' + String(sub.성취수준).split(' ')[0] : ''}</td>
            <td style="padding: 12px 16px; font-size: 0.8rem; color: var(--text-secondary);">${sub.제출시간 || '-'}</td>
        `;
        
        row.addEventListener('click', () => {
            state.selectedSubmissionId = idx;
            renderSubmissionsList();
            showSubmissionDetail(sub);
        });
        
        listBody.appendChild(row);
    });
}

// 명단에서 선택한 개별 학생 평가 상세 보기
function showSubmissionDetail(sub) {
    const emptyPanel = document.getElementById('submission-detail-empty');
    const contentPanel = document.getElementById('submission-detail-content');
    const actionsPanel = document.getElementById('submission-detail-actions');
    
    if (!emptyPanel || !contentPanel) return;
    
    emptyPanel.style.display = 'none';
    contentPanel.style.display = 'block';
    if (actionsPanel) actionsPanel.style.display = 'flex';
    
    document.getElementById('sub-detail-student-title').textContent = `${sub.이름 || '-'} (${sub.학년 || '-'} ${sub.반 || '-'} ${sub.번호 || '-'})`;
    document.getElementById('sub-detail-time').textContent = `제출시간: ${sub.제출시간 || '-'}`;
    const achText = sub.성취수준 ? `  ·  성취수준 ${sub.성취수준}` : '';
    document.getElementById('sub-detail-score').textContent = `${sub.총점 || '0'} / 100${achText}`;
    
    // 기준별 상세 점수 파싱
    const scoresList = document.getElementById('sub-detail-scores-list');
    scoresList.innerHTML = '';
    const scoresText = sub.평가기준별점수 || '';
    scoresText.split('\n').forEach(line => {
        if (line.trim()) {
            const parts = line.split(':');
            const div = document.createElement('div');
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.innerHTML = `<span>${parts[0]}</span><strong style="color:var(--color-indigo, #6366f1);">${parts[1] || ''}</strong>`;
            scoresList.appendChild(div);
        }
    });
    
    document.getElementById('sub-detail-student-text').textContent = sub.작성글 || '';
    document.getElementById('sub-detail-strengths').textContent = sub.강점 || '';
    document.getElementById('sub-detail-weaknesses').textContent = sub.개선점 || '';
    document.getElementById('sub-detail-model').textContent = sub.모범답안 || '';
    
    // 첨삭 예시 리스트 렌더링
    const revisionsContainer = document.getElementById('sub-detail-revisions');
    revisionsContainer.innerHTML = '';
    try {
        const revisions = JSON.parse(sub.첨삭내용 || '[]');
        if (Array.isArray(revisions) && revisions.length > 0) {
            revisions.forEach((rev, idx) => {
                const div = document.createElement('div');
                div.className = 'revision-item';
                div.style.padding = '12px';
                div.style.border = '1px solid var(--border-color)';
                div.style.borderRadius = '4px';
                div.style.backgroundColor = '#fafafa';
                div.style.marginBottom = '8px';
                div.innerHTML = `
                    <div style="font-weight:bold; font-size:0.8rem; margin-bottom:4px; color:var(--text-secondary);">[문장 ${idx+1}]</div>
                    <div style="color:#ef4444; font-size:0.85rem; text-decoration:line-through; margin-bottom:2px;">이전: ${rev.before}</div>
                    <div style="color:#10b981; font-size:0.85rem; font-weight:600; margin-bottom:4px;">이후: ${rev.after}</div>
                    <div style="font-size:0.8rem; color:#4b5563; border-top:1px dashed #e2e8f0; padding-top:4px; margin-top:4px;">설명: ${rev.comment}</div>
                `;
                revisionsContainer.appendChild(div);
            });
        } else if (sub.첨삭내용 && sub.첨삭내용.trim() !== '없음') {
            revisionsContainer.innerHTML = `<div style="font-size:0.85rem; white-space:pre-wrap; padding:12px; background:#fafafa; border:1px solid var(--border-color); border-radius:4px;">${sub.첨삭내용}</div>`;
        } else {
            revisionsContainer.innerHTML = '<p style="color:var(--text-secondary); font-style:italic; font-size:0.85rem;">첨삭 내역이 없습니다.</p>';
        }
    } catch (e) {
        if (sub.첨삭내용 && sub.첨삭내용.trim() !== '없음') {
            revisionsContainer.innerHTML = `<div style="font-size:0.85rem; white-space:pre-wrap; padding:12px; background:#fafafa; border:1px solid var(--border-color); border-radius:4px;">${sub.첨삭내용}</div>`;
        } else {
            revisionsContainer.innerHTML = '<p style="color:var(--text-secondary); font-style:italic; font-size:0.85rem;">첨삭 내역이 없습니다.</p>';
        }
    }
    
    // Word 다운로드 이벤트 매핑 복제 연결
    const btnWord = document.getElementById('btn-download-submission-word');
    if (btnWord) {
        const newBtn = btnWord.cloneNode(true);
        btnWord.parentNode.replaceChild(newBtn, btnWord);
        newBtn.addEventListener('click', () => {
            downloadSubmissionAsWord(sub);
        });
    }
}

// 개별 대시보드 선택 항목 Word로 저장
function downloadSubmissionAsWord(sub) {
    let totalMax = 0;
    let rubricsRows = '';
    
    const scoresText = sub.평가기준별점수 || '';
    scoresText.split('\n').forEach(line => {
        if (line.trim()) {
            const parts = line.split(':');
            const scorePart = parts[1] || '';
            const valParts = scorePart.replace('점', '').split('/');
            const score = parseInt(valParts[0]) || 0;
            const max = parseInt(valParts[1]) || 0;
            totalMax += max;
            rubricsRows += `
                <tr>
                    <td style="padding: 8px; border: 1px solid #cbd5e1; font-weight: bold;">${parts[0]}</td>
                    <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 0.85rem;">-</td>
                    <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold; color: #4f46e5;">${score} / ${max}점</td>
                </tr>
            `;
        }
    });
    
    let revisionsContent = '';
    try {
        const revisions = JSON.parse(sub.첨삭내용 || '[]');
        if (Array.isArray(revisions) && revisions.length > 0) {
            revisions.forEach((rev, idx) => {
                revisionsContent += `
                    <div style="margin-bottom: 12px; padding: 10px; border-left: 3px solid #f59e0b; background-color: #fffbeb;">
                        <p style="margin: 0 0 4px 0; font-weight: bold;">[문장 ${idx+1}]</p>
                        <p style="margin: 0 0 4px 0; color: #dc2626;"><del>이전: ${rev.before}</del></p>
                        <p style="margin: 0 0 4px 0; color: #16a34a;"><strong>이후: ${rev.after}</strong></p>
                        <p style="margin: 0; font-size: 0.85rem; color: #4b5563;">설명: ${rev.comment}</p>
                    </div>
                `;
            });
        } else if (sub.첨삭내용 && sub.첨삭내용.trim() !== '없음') {
            revisionsContent = `<div style="padding: 10px; border: 1px solid #cbd5e1; background-color: #fafafa;">${sub.첨삭내용.replace(/\n/g, '<br>')}</div>`;
        } else {
            revisionsContent = '<p style="color: #6b7280; font-style: italic;">수정 권장 문장 없음</p>';
        }
    } catch (e) {
        if (sub.첨삭내용 && sub.첨삭내용.trim() !== '없음') {
            revisionsContent = `<div style="padding: 10px; border: 1px solid #cbd5e1; background-color: #fafafa;">${sub.첨삭내용.replace(/\n/g, '<br>')}</div>`;
        } else {
            revisionsContent = '<p style="color: #6b7280; font-style: italic;">수정 권장 문장 없음</p>';
        }
    }
    
    const studentMeta = `${sub.학년 || '-'} ${sub.반 || '-'} ${sub.번호 || '-'} 이름: ${sub.이름 || '-'}`;
    
    const htmlContent = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
        <title>국어 작문 AI 평가 결과 보고서</title>
        <style>
            body { font-family: 'Malgun Gothic', 'Dotum', sans-serif; line-height: 1.6; color: #334155; padding: 20px; }
            .title { font-size: 20pt; font-weight: bold; color: #4f46e5; text-align: center; margin-bottom: 10px; }
            .meta-box { background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; margin-bottom: 24px; }
            h2 { font-size: 14pt; color: #1e1b4b; border-bottom: 2px solid #4f46e5; padding-bottom: 4px; margin-top: 24px; }
            table.rubric-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            table.rubric-table th { background-color: #f1f5f9; padding: 8px; border: 1px solid #cbd5e1; font-weight: bold; text-align: left; }
            .box { padding: 12px; border: 1px solid #e2e8f0; border-radius: 4px; background-color: #fafafa; }
            .strength-box { border-left: 4px solid #10b981; background-color: #f0fdf4; padding: 12px; margin-bottom: 10px; }
            .weakness-box { border-left: 4px solid #f59e0b; background-color: #fffbeb; padding: 12px; }
        </style>
    </head>
    <body>
        <div class="title">국어 작문 AI 평가 및 피드백 보고서</div>
        <div style="text-align: center; font-size: 10pt; color: #64748b; margin-bottom: 20px;">제출 일시: ${sub.제출시간 || '-'}</div>
        
        <div class="meta-box">
            <table style="width:100%; border:none;">
                <tr>
                    <td style="font-weight:bold; width: 15%;">과제명:</td>
                    <td style="width: 45%;">${sub.과제명 || '-'}</td>
                    <td style="font-weight:bold; width: 15%;">대상 학생:</td>
                    <td style="width: 25%;">${studentMeta}</td>
                </tr>
            </table>
        </div>

        <h2>1. 종합 채점 결과: <span style="color:#4f46e5;">${sub.총점 || '0'} / ${totalMax || '100'}점</span>${sub.성취수준 ? ` <span style="font-size:12pt; color:#4f46e5;">(성취수준 ${sub.성취수준})</span>` : ''}</h2>
        <table class="rubric-table">
            <thead>
                <tr>
                    <th style="width: 30%;">평가 항목</th>
                    <th style="width: 50%;">평가 기준</th>
                    <th style="width: 20%; text-align: center;">획득 점수</th>
                </tr>
            </thead>
            <tbody>
                ${rubricsRows}
            </tbody>
        </table>

        <h2>2. 종합 평가 피드백</h2>
        <div class="strength-box">
            <p style="margin:0; font-weight:bold; color:#14532d; font-size:10.5pt;">[강점]</p>
            <p style="margin:4px 0 0 0; color:#14532d; font-size:10pt;">${(sub.강점 || '').replace(/\n/g, '<br>')}</p>
        </div>
        <div class="weakness-box">
            <p style="margin:0; font-weight:bold; color:#78350f; font-size:10.5pt;">[약점 및 개선 방향]</p>
            <p style="margin:4px 0 0 0; color:#78350f; font-size:10pt;">${(sub.개선점 || '').replace(/\n/g, '<br>')}</p>
        </div>

        <h2>3. 문장 교정 및 첨삭 지도</h2>
        <div>
            ${revisionsContent}
        </div>

        <h2>4. 모범 답안 예시</h2>
        <div class="box" style="font-size: 10pt;">
            ${(sub.모범답안 || '').replace(/\n/g, '<br>')}
        </div>

        <h2>5. 작성한 글 원문</h2>
        <div class="box" style="font-size: 10pt; background-color: #ffffff;">
            ${(sub.작성글 || '').replace(/\n/g, '<br>')}
        </div>
    </body>
    </html>
    `;
    
    const blob = new Blob(['\ufeff' + htmlContent], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    const infoStr = sub.이름 ? `_${sub.학년}_${sub.반}_${sub.번호}_${sub.이름}` : '';
    const sanitizedTitle = (sub.과제명 || '국어평가').replace(/[^a-zA-Z0-9가-힣\s]/g, '');
    link.setAttribute('download', `국어평가피드백_${sanitizedTitle}${infoStr}.doc`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// 개별 학생 결과 탭에서 Word로 저장
function downloadResultAsWord(result) {
    let totalAcquired = 0;
    let totalMax = 0;
    let rubricsRows = '';
    
    result.rubricsSnapshot.forEach(rubric => {
        const score = result.scores[rubric.id] || 0;
        totalAcquired += score;
        totalMax += rubric.maxScore;
        rubricsRows += `
            <tr>
                <td style="padding: 8px; border: 1px solid #cbd5e1; font-weight: bold;">${rubric.title}</td>
                <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 0.85rem;">${rubric.description}</td>
                <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold; color: #4f46e5;">${score} / ${rubric.maxScore}점</td>
            </tr>
        `;
    });
    
    let revisionsContent = '';
    if (result.revisions && result.revisions.length > 0) {
        result.revisions.forEach((rev, idx) => {
            revisionsContent += `
                <div style="margin-bottom: 12px; padding: 10px; border-left: 3px solid #f59e0b; background-color: #fffbeb;">
                    <p style="margin: 0 0 4px 0; font-weight: bold;">[문장 ${idx+1}]</p>
                    <p style="margin: 0 0 4px 0; color: #dc2626;"><del>이전: ${rev.before}</del></p>
                    <p style="margin: 0 0 4px 0; color: #16a34a;"><strong>이후: ${rev.after}</strong></p>
                    <p style="margin: 0; font-size: 0.85rem; color: #4b5563;">설명: ${rev.comment}</p>
                </div>
            `;
        });
    } else {
        revisionsContent = '<p style="color: #6b7280; font-style: italic;">수정 권장 문장 없음</p>';
    }
    
    const info = result.studentInfo || {};
    const studentMeta = info.name ? `${info.grade || '-'}학년 ${info.class || '-'}반 ${info.number || '-'}번 이름: ${info.name}` : '학생 정보 없음';
    const ach = computeOverallAchievement(totalAcquired, totalMax);

    const htmlContent = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
        <title>국어 작문 AI 평가 결과 보고서</title>
        <style>
            body { font-family: 'Malgun Gothic', 'Dotum', sans-serif; line-height: 1.6; color: #334155; padding: 20px; }
            .title { font-size: 20pt; font-weight: bold; color: #4f46e5; text-align: center; margin-bottom: 10px; }
            .meta-box { background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; margin-bottom: 24px; }
            h2 { font-size: 14pt; color: #1e1b4b; border-bottom: 2px solid #4f46e5; padding-bottom: 4px; margin-top: 24px; }
            table.rubric-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            table.rubric-table th { background-color: #f1f5f9; padding: 8px; border: 1px solid #cbd5e1; font-weight: bold; text-align: left; }
            .box { padding: 12px; border: 1px solid #e2e8f0; border-radius: 4px; background-color: #fafafa; }
            .strength-box { border-left: 4px solid #10b981; background-color: #f0fdf4; padding: 12px; margin-bottom: 10px; }
            .weakness-box { border-left: 4px solid #f59e0b; background-color: #fffbeb; padding: 12px; }
        </style>
    </head>
    <body>
        <div class="title">국어 작문 AI 평가 및 피드백 보고서</div>
        <div style="text-align: center; font-size: 10pt; color: #64748b; margin-bottom: 20px;">제출 일시: ${result.timestamp}</div>
        
        <div class="meta-box">
            <table style="width:100%; border:none;">
                <tr>
                    <td style="font-weight:bold; width: 15%;">과제명:</td>
                    <td style="width: 45%;">${result.assignmentTitle}</td>
                    <td style="font-weight:bold; width: 15%;">대상 학생:</td>
                    <td style="width: 25%;">${studentMeta}</td>
                </tr>
            </table>
        </div>

        <h2>1. 종합 채점 결과: <span style="color:#4f46e5;">${totalAcquired} / ${totalMax}점</span> <span style="font-size:12pt; color:#4f46e5;">(성취수준 ${ach.level} · ${ach.label}, ${ach.percentage}%)</span></h2>
        <table class="rubric-table">
            <thead>
                <tr>
                    <th style="width: 30%;">평가 항목</th>
                    <th style="width: 50%;">평가 기준</th>
                    <th style="width: 20%; text-align: center;">획득 점수</th>
                </tr>
            </thead>
            <tbody>
                ${rubricsRows}
            </tbody>
        </table>

        <h2>2. 종합 평가 피드백</h2>
        <div class="strength-box">
            <p style="margin:0; font-weight:bold; color:#14532d; font-size:10.5pt;">[강점]</p>
            <p style="margin:4px 0 0 0; color:#14532d; font-size:10pt;">${result.strengths.replace(/\n/g, '<br>')}</p>
        </div>
        <div class="weakness-box">
            <p style="margin:0; font-weight:bold; color:#78350f; font-size:10.5pt;">[약점 및 개선 방향]</p>
            <p style="margin:4px 0 0 0; color:#78350f; font-size:10pt;">${result.weaknesses.replace(/\n/g, '<br>')}</p>
        </div>

        <h2>3. 문장 교정 및 첨삭 지도</h2>
        <div>
            ${revisionsContent}
        </div>

        <h2>4. 모범 답안 예시</h2>
        <div class="box" style="font-size: 10pt;">
            ${result.modelEssay.replace(/\n/g, '<br>')}
        </div>

        <h2>5. 작성한 글 원문</h2>
        <div class="box" style="font-size: 10pt; background-color: #ffffff;">
            ${result.studentText.replace(/\n/g, '<br>')}
        </div>
    </body>
    </html>
    `;
    
    const blob = new Blob(['\ufeff' + htmlContent], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    const infoStr = info.name ? `_${info.grade}학년${info.class}반${info.number}번_${info.name}` : '';
    const sanitizedTitle = result.assignmentTitle.replace(/[^a-zA-Z0-9가-힣\s]/g, '');
    link.setAttribute('download', `국어평가피드백_${sanitizedTitle}${infoStr}.doc`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// 교사용 제출 현황 대시보드 제어 및 클릭 리스너 바인딩
function setupSubmissionsDashboardHandlers() {
    const btnRefresh = document.getElementById('btn-refresh-submissions');
    const filterClass = document.getElementById('filter-class');
    const filterAssignment = document.getElementById('filter-assignment');
    const searchStudent = document.getElementById('search-student');
    const btnSaveSheet = document.getElementById('btn-save-sheet-url');
    const sheetInput = document.getElementById('sheet-url-input');
    const btnCopyScript = document.getElementById('btn-copy-apps-script');
    
    // 설정값 연동 로드
    if (sheetInput) sheetInput.value = state.sheetUrl || '';
    
    // 구글 스프레드시트 설정 저장
    if (btnSaveSheet && sheetInput) {
        btnSaveSheet.addEventListener('click', () => {
            const url = sheetInput.value.trim();
            state.sheetUrl = url;
            saveStateToStorage();
            showToast('구글 스프레드시트 연동 주소가 저장되었습니다.', 'success');
        });
    }
    
    // Apps Script 코드 복사
    if (btnCopyScript) {
        btnCopyScript.addEventListener('click', () => {
            const codeBox = document.getElementById('apps-script-code-box');
            if (codeBox) {
                navigator.clipboard.writeText(codeBox.value)
                    .then(() => showToast('Apps Script 소스코드가 클립보드에 복사되었습니다!', 'success'))
                    .catch(() => showToast('코드 복사에 실패했습니다.', 'error'));
            }
        });
    }
    
    // 대시보드 새로고침
    if (btnRefresh) {
        btnRefresh.addEventListener('click', () => {
            loadSubmissionsFromGoogleSheets();
        });
    }
    
    // 학급 정보 필터
    if (filterClass) {
        filterClass.addEventListener('change', () => {
            renderSubmissionsList();
        });
    }

    // 과제명(주제) 필터
    if (filterAssignment) {
        filterAssignment.addEventListener('change', () => {
            renderSubmissionsList();
        });
    }

    // 이름 검색 필터
    if (searchStudent) {
        searchStudent.addEventListener('input', () => {
            renderSubmissionsList();
        });
    }
}

// --- App Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Load local storage states
    loadStateFromStorage();
    
    // Check url data parameters and apply if present
    checkAndLoadSharedData();
    
    // Initialize icons
    lucide.createIcons();
    
    // 학생 학적 정보 입력 폼 초기값 복원
    const gradeSelect = document.getElementById('student-grade');
    const classInput = document.getElementById('student-class');
    const numberInput = document.getElementById('student-number');
    const nameInput = document.getElementById('student-name');
    if (gradeSelect) gradeSelect.value = state.studentInfo.grade || '';
    if (classInput) classInput.value = state.studentInfo.class || '';
    if (numberInput) numberInput.value = state.studentInfo.number || '';
    if (nameInput) nameInput.value = state.studentInfo.name || '';
    
    // Setup component handlers
    setupTabs();
    checkTeacherModeAndSetupSidebar(); // URL 파라미터 체크하여 교사용 메뉴 설정
    updateApiStatusIndicator();
    setupApiKeyHandlers();
    setupTeacherPasswordHandlers(); // 교사 비밀번호 관리 핸들러 연동
    setupTeacherViewHandlers();
    setupStudentViewHandlers();
    setupResultsViewHandlers();
    setupShareLinkHandlers(); // 공유 링크 생성 핸들러 연동
    setupSubmissionsDashboardHandlers(); // 구글 대시보드 핸들러 연동
    setupTeacherGotoDropdown(); // 교사 모드 상단 '학생 화면 바로가기' 드롭다운 연동
    setupAssignmentLibraryHandlers(); // 교사 모드 과제 보관함 연동
});
