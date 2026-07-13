// Application State
let state = {
    apiKey: '',
    selectedModel: 'gemini-1.5-flash', // Automatically updated based on API key permissions
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
    currentResultId: null // ID of the currently viewed result
};

// --- LocalStorage Logic ---
const STORAGE_KEYS = {
    API_KEY: 'kwa_api_key',
    SELECTED_MODEL: 'kwa_selected_model',
    TEACHER_PASSWORD: 'kwa_teacher_password',
    ASSIGNMENT: 'kwa_assignment',
    RUBRICS: 'kwa_rubrics',
    RESULTS: 'kwa_results'
};

function loadStateFromStorage() {
    state.apiKey = localStorage.getItem(STORAGE_KEYS.API_KEY) || '';
    state.selectedModel = localStorage.getItem(STORAGE_KEYS.SELECTED_MODEL) || 'gemini-1.5-flash';
    state.teacherPassword = localStorage.getItem(STORAGE_KEYS.TEACHER_PASSWORD) || '1234';
    
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
}

function saveStateToStorage() {
    localStorage.setItem(STORAGE_KEYS.API_KEY, state.apiKey);
    localStorage.setItem(STORAGE_KEYS.SELECTED_MODEL, state.selectedModel);
    localStorage.setItem(STORAGE_KEYS.TEACHER_PASSWORD, state.teacherPassword);
    localStorage.setItem(STORAGE_KEYS.ASSIGNMENT, JSON.stringify(state.assignment));
    localStorage.setItem(STORAGE_KEYS.RUBRICS, JSON.stringify(state.rubrics));
    localStorage.setItem(STORAGE_KEYS.RESULTS, JSON.stringify(state.results));
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
async function callGemini(prompt, useJson = true) {
    if (!state.apiKey) {
        throw new Error('API Key가 등록되지 않았습니다. [설정 & API] 탭에서 등록해 주세요.');
    }
    
    const model = state.selectedModel || 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${state.apiKey}`;
    
    const requestBody = {
        contents: [
            {
                parts: [
                    { text: prompt }
                ]
            }
        ]
    };
    
    // responseMimeType 필드는 일부 구형/특정 모델에서 에러를 유발하므로 제거합니다.
    // 대신 프롬프트에 JSON 출력을 강력히 명시하고, 응답에서 파싱합니다.
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            const errData = await response.json();
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
        
    } catch (error) {
        console.error('Gemini API Error:', error);
        throw error;
    }
}

// --- API Validation ---
async function validateApiKey(key) {
    // 1. Get the list of all available models for this API key to see which Gemini models are accessible
    const listUrl = `https://generativelanguage.googleapis.com/v1/models?key=${key}`;
    try {
        const response = await fetch(listUrl, { method: 'GET' });
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error?.message || `API 키 오류 (코드: ${response.status})`);
        }
        
        const data = await response.json();
        if (!data.models || data.models.length === 0) {
            throw new Error('사용 가능한 AI 모델이 계정에 존재하지 않습니다.');
        }
        
        // Extract names (e.g. "models/gemini-1.5-flash" -> "gemini-1.5-flash")
        const allModels = data.models.map(m => m.name.replace('models/', ''));
        // Filter only gemini models
        const geminiModels = allModels.filter(name => name.toLowerCase().includes('gemini'));
        
        if (geminiModels.length === 0) {
            throw new Error('이 API Key로 액세스할 수 있는 Gemini 모델이 없습니다.');
        }
        
        // Sort models to try the best ones first (1.5-flash first, then others)
        geminiModels.sort((a, b) => {
            // Prefer 1.5-flash (but skip 8b which is low performance, though can be fallback)
            const aIsFlash15 = a.includes('1.5-flash') && !a.includes('8b');
            const bIsFlash15 = b.includes('1.5-flash') && !b.includes('8b');
            if (aIsFlash15 && !bIsFlash15) return -1;
            if (!aIsFlash15 && bIsFlash15) return 1;
            
            // Then prefer 2.0-flash or 2.5-flash
            const aIsFlash2 = a.includes('2.0-flash') || a.includes('2.5-flash');
            const bIsFlash2 = b.includes('2.0-flash') || b.includes('2.5-flash');
            if (aIsFlash2 && !bIsFlash2) return -1;
            if (!aIsFlash2 && bIsFlash2) return 1;
            
            return 0;
        });

        console.log('Testing Gemini models in order:', geminiModels);
        
        let matchedModel = '';
        let lastErrorMessage = '';
        
        // 2. Test each model until we find one that successfully responds (has quota > 0)
        for (const model of geminiModels) {
            try {
                const testUrl = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${key}`;
                const testResponse = await fetch(testUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: 'Hello' }] }]
                    })
                });
                
                if (testResponse.ok) {
                    matchedModel = model;
                    break; // Found a working model with active quota!
                } else {
                    const errData = await testResponse.json();
                    lastErrorMessage = errData.error?.message || `코드 ${testResponse.status}`;
                    console.warn(`Model ${model} test failed:`, lastErrorMessage);
                }
            } catch (err) {
                lastErrorMessage = err.message || '네트워크 오류';
                console.warn(`Model ${model} test error:`, lastErrorMessage);
            }
        }
        
        if (!matchedModel) {
            throw new Error(`사용가능한 모든 AI 모델의 쿼터 한도가 초과되었거나 제한되어 있습니다. (최종 실패 사유: ${lastErrorMessage})`);
        }
        
        // Update state and save
        state.selectedModel = matchedModel;
        console.log('Successfully validated API Key. Selected active model:', matchedModel);
        return true;
    } catch (error) {
        throw new Error(error.message || '네트워크 연결 실패');
    }
}

// --- UI rendering & Interaction Logic ---

// Tab switching
function setupTabs() {
    const navItems = document.querySelectorAll('.nav-item');
    const tabPanels = document.querySelectorAll('.tab-panel');
    
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            const targetTab = item.getAttribute('data-tab');
            
            // 2차 비밀번호 잠금 체크: 교사용 탭(config, teacher) 진입 시
            if (targetTab === 'config' || targetTab === 'teacher') {
                const isVerified = sessionStorage.getItem('kwa_is_teacher') === 'true';
                
                // 비밀번호가 설정되어 있고 아직 세션 인증이 안 된 경우
                if (state.teacherPassword && !isVerified) {
                    const passwordAttempt = prompt('교사 인증 비밀번호를 입력해 주세요:');
                    
                    if (passwordAttempt === state.teacherPassword) {
                        sessionStorage.setItem('kwa_is_teacher', 'true');
                        showToast('교사 인증에 성공했습니다.', 'success');
                    } else {
                        if (passwordAttempt !== null) {
                            showToast('비밀번호가 올바르지 않습니다.', 'error');
                        }
                        // 이벤트 기본 동작 차단
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
    
    textarea.addEventListener('input', () => {
        updateCharCounter(textarea.value);
    });
    
    btnSubmit.addEventListener('click', async () => {
        const studentText = textarea.value.trim();
        
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
1. 각 영역 ID별로 부여할 획득 점수(정수)를 결정하십시오. 절대로 배점(maxScore)을 초과해서는 안 되며, 학생 글의 상태에 따라 엄격하고 정밀하게 채점하십시오.
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
        option.textContent = `[${res.timestamp.split(' ')[2] || ''}] ${res.assignmentTitle.slice(0, 15)}...`;
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
                <span class="score-bar-values">${score} / ${rubric.maxScore}점</span>
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
        
        const copyText = `[국어 글쓰기 AI 평가 결과]\n` +
            `과제명: ${currentRes.assignmentTitle}\n` +
            `일시: ${currentRes.timestamp}\n\n` +
            `■ 종합 점수: ${totalAcquired}/${totalMax}점\n` +
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
        
        const content = `==================================================\n` +
            `          국어 작문 AI 평가 및 피드백 보고서\n` +
            `==================================================\n` +
            `과제명: ${currentRes.assignmentTitle}\n` +
            `일시: ${currentRes.timestamp}\n\n` +
            `--------------------------------------------------\n` +
            `1. 종합 평가 결과: ${totalAcquired} / ${totalMax}점\n` +
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
}

// URL 파라미터 체크하여 교사 모드 여부에 따라 사이드바 탭 제어
function checkTeacherModeAndSetupSidebar() {
    const urlParams = new URLSearchParams(window.location.search);
    const isTeacherModeUrl = urlParams.get('mode') === 'teacher';
    
    // 교사 전용 탭 (설정 & 교사모드 설계)
    const teacherNavItems = document.querySelectorAll('.nav-item[data-tab="config"], .nav-item[data-tab="teacher"]');
    
    if (!isTeacherModeUrl) {
        // 교사 모드가 아닐 때 (학생 접속) -> 탭 버튼 숨김
        teacherNavItems.forEach(item => {
            item.style.display = 'none';
        });
        
        // 현재 active된 탭이 교사용 탭(config 등)이라면 student 탭으로 활성화 탭을 강제 이전
        const activeNavItem = document.querySelector('.nav-item.active');
        const activeTab = activeNavItem ? activeNavItem.getAttribute('data-tab') : '';
        if (activeTab === 'config' || activeTab === 'teacher') {
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
    }
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
            includeApiKey: checkApiKey.checked
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
            const shareUrl = `${baseUrl}?data=${encodedData}`;
            
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

// --- App Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Load local storage states
    loadStateFromStorage();
    
    // Check url data parameters and apply if present
    checkAndLoadSharedData();
    
    // Initialize icons
    lucide.createIcons();
    
    // Setup component handlers
    setupTabs();
    checkTeacherModeAndSetupSidebar(); // URL 파라미터 체크하여 교사용 메뉴 숨김
    updateApiStatusIndicator();
    setupApiKeyHandlers();
    setupTeacherPasswordHandlers(); // 교사 비밀번호 관리 핸들러 연동
    setupTeacherViewHandlers();
    setupStudentViewHandlers();
    setupResultsViewHandlers();
    setupShareLinkHandlers(); // 공유 링크 생성 핸들러 연동
});
