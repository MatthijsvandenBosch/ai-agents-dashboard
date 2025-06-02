// useAgentAPI.js
/**
 * Queue to manage API requests and prevent rate limiting
 */
const requestQueue = [];
let isProcessingQueue = false;
let lastRequestTime = 0;
let cooldownUntil = 0; // Timestamp until when we should cool down
const MIN_REQUEST_INTERVAL = 2000; // Minimum 2 seconds between requests
const BATCH_SIZE = 3; // Maximum number of similar requests to batch together
const COOLDOWN_PERIOD = 60000; // 60 seconds cooldown after rate limit

// API Provider and Model Management
let currentProvider = 'openai'; // Default provider
let currentOpenAIApiKey = null;
let currentClaudeApiKey = null;
let currentOrgId = null; // Organization ID for API requests (OpenAI specific)

// Default model setting
let currentModel = 'gpt-3.5-turbo'; // Default model for OpenAI

// Offline mode flag - DEFAULT TO TRUE for first use
let offlineMode = true;

// Failed API call counter for automatic fallback
let failedApiCallsCount = 0;
const MAX_FAILED_CALLS_BEFORE_FALLBACK = 3;

// Global API limit counter
let globalApiCallCounter = {
  total: 0,
  successful: 0,
  failed: 0,
  rateLimited: 0,
  lastReset: Date.now()
};

const AVAILABLE_PROVIDERS = {
  openai: {
    name: 'OpenAI',
    models: {
      'gpt-4': { name: 'GPT-4', description: 'Meest geavanceerd, lagere rate limits' },
      'gpt-3.5-turbo': { name: 'GPT-3.5 Turbo', description: 'Sneller en hogere rate limits' },
      'gpt-4o': { name: 'GPT-4o', description: 'Nieuwste model, snel en capabel' },
    },
    defaultModel: 'gpt-3.5-turbo',
  },
  anthropic: {
    name: 'Anthropic (Claude)',
    models: {
      'claude-3-opus-20240229': { name: 'Claude 3 Opus', description: 'Meest krachtig, voor complexe taken' },
      'claude-3-sonnet-20240229': { name: 'Claude 3 Sonnet', description: 'Balans tussen intelligentie en snelheid' },
      'claude-3-haiku-20240307': { name: 'Claude 3 Haiku', description: 'Snelste en meest compacte model' },
    },
    defaultModel: 'claude-3-haiku-20240307',
  },
};

// Queue status for UI display
const queueStatus = {
  totalQueued: 0,
  currentlyProcessing: false,
  estimatedTimeRemaining: 0,
  lastError: null,
  rateLimitHit: false,
  batchMode: false,
  isPaused: false,
  cooldownRemaining: 0,
  apiKeyStatus: 'unknown', // 'valid', 'invalid', 'rate_limited', 'unknown'
  currentProvider: currentProvider,
  currentModel: currentModel,
  offlineMode: offlineMode, // Default to true
  apiCallStats: globalApiCallCounter,
  availableModels: AVAILABLE_PROVIDERS[currentProvider].models, // Initialize with default provider's models
  availableProviders: AVAILABLE_PROVIDERS,
};

/**
 * Detect API key type and format
 * @param {string} apiKey - The API key to check
 * @returns {Object} - Information about the API key
 */
const detectApiKeyType = (apiKey) => {
  if (!apiKey) {
    return { valid: false, type: 'unknown', message: 'No API key provided' };
  }
  if (apiKey.startsWith('sk-proj-')) {
    console.log('Detected OpenAI project-based API key');
    return { valid: true, type: 'openai-project', message: 'Using OpenAI project-based API key', requiresSpecialHeaders: true };
  }
  if (apiKey.startsWith('sk-ant-api03-')) {
    console.log('Detected Anthropic API key');
    return { valid: true, type: 'anthropic', message: 'Using Anthropic API key', requiresSpecialHeaders: false };
  }
  if (apiKey.startsWith('sk-') && !apiKey.startsWith('sk-proj-')) {
    console.log('Detected OpenAI standard API key');
    return { valid: true, type: 'openai-standard', message: 'Using OpenAI standard API key', requiresSpecialHeaders: false };
  }
  return { valid: false, type: 'unknown', message: 'Invalid API key format.' };
};

/**
 * Get current queue status for UI display
 * @returns {Object} Current queue status
 */
export const getQueueStatus = () => {
  if (cooldownUntil > Date.now()) {
    queueStatus.cooldownRemaining = cooldownUntil - Date.now();
  } else {
    queueStatus.cooldownRemaining = 0;
  }
  queueStatus.currentProvider = currentProvider;
  queueStatus.currentModel = currentModel;
  queueStatus.availableModels = AVAILABLE_PROVIDERS[currentProvider].models;
  queueStatus.offlineMode = offlineMode;
  queueStatus.apiCallStats = globalApiCallCounter;
  return { ...queueStatus };
};

/**
 * Toggle batch mode on/off
 * @param {boolean} enabled - Whether to enable batch mode
 */
export const setBatchMode = (enabled) => {
  queueStatus.batchMode = enabled;
  console.log(`Batch mode ${enabled ? 'enabled' : 'disabled'}`);
  localStorage.setItem('aiAgentDashboard_batchMode', enabled.toString());
};

/**
 * Set the API provider
 * @param {string} provider - The provider to use ('openai' or 'anthropic')
 * @returns {boolean} - Whether the provider was successfully set
 */
export const setProvider = (provider) => {
  if (!AVAILABLE_PROVIDERS[provider]) {
    console.error(`Invalid provider: ${provider}`);
    return false;
  }
  currentProvider = provider;
  currentModel = AVAILABLE_PROVIDERS[provider].defaultModel; // Set default model for new provider
  queueStatus.currentProvider = provider;
  queueStatus.currentModel = currentModel;
  queueStatus.availableModels = AVAILABLE_PROVIDERS[provider].models;
  console.log(`Provider set to ${provider}, model set to ${currentModel}`);
  localStorage.setItem('aiAgentDashboard_currentProvider', provider);
  localStorage.setItem('aiAgentDashboard_currentModel', currentModel); // Save default model too
  resetApiStatus(); // Reset status as API key and limits might change
  return true;
};

/**
 * Set the model to use for API calls
 * @param {string} modelId - The model to use
 * @returns {boolean} - Whether the model was successfully set
 */
export const setModel = (modelId) => {
  if (!AVAILABLE_PROVIDERS[currentProvider].models[modelId]) {
    console.error(`Invalid model: ${modelId} for provider ${currentProvider}`);
    return false;
  }
  currentModel = modelId;
  queueStatus.currentModel = modelId;
  console.log(`Model set to ${modelId} for provider ${currentProvider}`);
  localStorage.setItem('aiAgentDashboard_currentModel', modelId);
  if (queueStatus.rateLimitHit) {
    cooldownUntil = 0;
    queueStatus.rateLimitHit = false;
    queueStatus.cooldownRemaining = 0;
    console.log('Rate limit status reset due to model change');
  }
  return true;
};


/**
 * Set the organization ID for API requests (OpenAI specific)
 * @param {string} orgId - The organization ID to use
 * @returns {boolean} - Whether the organization ID was successfully set
 */
export const setOrganizationId = (orgId) => {
  if (!orgId || orgId.trim() === '') {
    currentOrgId = null;
    localStorage.removeItem('aiAgentDashboard_orgId');
    console.log('Organization ID cleared');
    return true;
  }
  currentOrgId = orgId.trim();
  console.log(`Organization ID set to ${currentOrgId}`);
  localStorage.setItem('aiAgentDashboard_orgId', currentOrgId);
  return true;
};

/**
 * Get available models for the current provider
 * @returns {Object} - Available models
 */
export const getAvailableModels = () => {
  return AVAILABLE_PROVIDERS[currentProvider].models;
};

/**
 * Get current model
 * @returns {string} - Current model
 */
export const getCurrentModel = () => {
  return currentModel;
};

/**
 * Reset API status - clears all rate limits, cooldowns and errors
 * @returns {boolean} - Whether the reset was successful
 */
export const resetApiStatus = () => {
  cooldownUntil = 0;
  queueStatus.rateLimitHit = false;
  queueStatus.lastError = null;
  queueStatus.apiKeyStatus = 'unknown';
  queueStatus.cooldownRemaining = 0;
  failedApiCallsCount = 0;
  const hadPendingRequests = requestQueue.length > 0;
  if (hadPendingRequests) {
    while (requestQueue.length > 0) {
      const request = requestQueue.shift();
      request.resolve('[SYSTEEM] API status gereset. Probeer opnieuw te verzenden.');
    }
    queueStatus.totalQueued = 0;
  }
  if (queueStatus.isPaused) {
    resumeRequests();
  }
  console.log('API status reset complete');
  return true;
};

/**
 * Toggle offline mode on/off
 * @param {boolean} enabled - Whether to enable offline mode
 * @returns {boolean} - Whether the mode was successfully set
 */
export const setOfflineMode = (enabled) => {
  offlineMode = enabled;
  queueStatus.offlineMode = enabled;
  localStorage.setItem('aiAgentDashboard_offlineMode', enabled.toString());

  if (enabled) {
    // If we're going offline, clear any processing state
    if (isProcessingQueue) {
      pauseRequests();
    }
    cooldownUntil = 0;
    queueStatus.cooldownRemaining = 0;
    queueStatus.rateLimitHit = false;

    console.log('Offline mode enabled, no real API calls will be made');
  } else {
    // If we're going online, check if we have valid API keys
    if (currentProvider === 'openai' && !currentOpenAIApiKey) {
      console.warn('Online mode enabled but no OpenAI API key is set');
      queueStatus.apiKeyStatus = 'invalid';
    } else if (currentProvider === 'anthropic' && !currentClaudeApiKey) {
      console.warn('Online mode enabled but no Claude API key is set');
      queueStatus.apiKeyStatus = 'invalid';
    } else {
      queueStatus.apiKeyStatus = 'valid'; // Assume valid until proven otherwise
    }

    console.log('Offline mode disabled, API calls will be made');
  }

  return enabled;
};

/**
 * Check if offline mode is enabled
 * @returns {boolean} - Whether offline mode is enabled
 */
export const isOfflineMode = () => {
  return offlineMode;
};

/**
 * Get global API call statistics
 * @returns {Object} - API call statistics
 */
export const getApiCallStats = () => {
  return { ...globalApiCallCounter };
};

/**
 * Reset API call statistics
 */
export const resetApiCallStats = () => {
  globalApiCallCounter = { total: 0, successful: 0, failed: 0, rateLimited: 0, lastReset: Date.now() };
  console.log('API call statistics reset');
};

/**
 * Update API call statistics
 * @param {string} type - Type of API call result ('success', 'fail', 'rateLimit')
 */
export const updateApiCallStats = (type) => {
  globalApiCallCounter.total++;
  switch (type) {
    case 'success': globalApiCallCounter.successful++; break;
    case 'fail': globalApiCallCounter.failed++; break;
    case 'rateLimit': globalApiCallCounter.rateLimited++; break;
  }
  if (globalApiCallCounter.rateLimited >= MAX_FAILED_CALLS_BEFORE_FALLBACK || failedApiCallsCount >= MAX_FAILED_CALLS_BEFORE_FALLBACK) {
    if (!offlineMode) { // Only switch if not already in offline mode
        console.warn(`Automatically switching to offline mode after ${MAX_FAILED_CALLS_BEFORE_FALLBACK} failed API calls`);
        setOfflineMode(true);
    }
  }
};

/**
 * Detect the agent type based on the prompt and message history
 * @param {string} prompt - The prompt text
 * @returns {string} - The detected agent type
 */
const detectAgentType = (prompt) => {
  prompt = prompt.toLowerCase();
  if (prompt.includes('lead developer') || prompt.includes('architectuur') || prompt.includes('beslissingen') || prompt.includes('requirements') || prompt.includes('technische beslissingen')) return 'lead-developer';
  if (prompt.includes('developer')) {
    if (prompt.includes('frontend') || prompt.includes('ui') || prompt.includes('user interface')) return 'developer-frontend';
    if (prompt.includes('backend') || prompt.includes('api') || prompt.includes('server-side')) return 'developer-backend';
    if (prompt.includes('database') || prompt.includes('sql') || prompt.includes('nosql')) return 'developer-database';
    if (prompt.includes('mobile') || prompt.includes('ios') || prompt.includes('android')) return 'developer-mobile';
    return 'developer-generic';
  }
  if (prompt.includes('tester') || prompt.includes('test') || prompt.includes('controleer') || prompt.includes('bugs') || prompt.includes('quality assurance')) return 'tester';
  if (prompt.includes('designer') || prompt.includes('ontwerp') || prompt.includes('ui/ux') || prompt.includes('mockup') || prompt.includes('wireframe')) return 'designer';
  if (prompt.includes('sales') || prompt.includes('verkoop') || prompt.includes('marketing') || prompt.includes('pitch')) return 'sales-agent';
  if (prompt.includes('devops') || prompt.includes('ci/cd') || prompt.includes('deployment') || prompt.includes('kubernetes') || prompt.includes('docker') || prompt.includes('infrastructuur')) return 'devops-engineer';
  if (prompt.includes('security') || prompt.includes('veiligheid') || prompt.includes('beveiliging') || prompt.includes('vulnerability') || prompt.includes('pentest')) return 'security-expert';
  if (prompt.includes('documentatie') || prompt.includes('docs') || prompt.includes('handleiding') || prompt.includes('instructies')) return 'documentation-writer';
  return 'unknown';
};

/**
 * Detect the request type based on the prompt
 * @param {string} prompt - The prompt text
 * @returns {string} - The detected request type
 */
const detectRequestType = (prompt) => {
  prompt = prompt.toLowerCase();
  if (prompt.includes('maak een') || prompt.includes('schrijf een') || prompt.includes('genereer') || prompt.includes('implementeer') || prompt.includes('ontwikkel')) {
    if (prompt.includes('javascript') || prompt.includes('js')) return 'code-javascript';
    if (prompt.includes('python')) return 'code-python';
    if (prompt.includes('java')) return 'code-java';
    if (prompt.includes('c#') || prompt.includes('csharp') || prompt.includes('c-sharp')) return 'code-csharp';
    if (prompt.includes('html') || prompt.includes('css') || prompt.includes('webpagina')) return 'code-web';
    if (prompt.includes('react') || prompt.includes('vue') || prompt.includes('angular') || prompt.includes('component')) return 'code-frontend-framework';
    if (prompt.includes('dockerfile')) return 'config-docker';
    if (prompt.includes('kubernetes') || prompt.includes('k8s')) return 'config-kubernetes';
    if (prompt.includes('ci/cd') || prompt.includes('pipeline')) return 'config-cicd';
    if (prompt.includes('api documentatie') || prompt.includes('gebruikershandleiding')) return 'documentation';
    return 'code-generic';
  }
  if (prompt.includes('ontwerp') || prompt.includes('design') || prompt.includes('mockup') || prompt.includes('wireframe') || prompt.includes('user interface') || prompt.includes('ux')) return 'design-ui-ux';
  if (prompt.includes('verkooptekst') || prompt.includes('marketingmateriaal') || prompt.includes('pitch deck') || prompt.includes('advertentie')) return 'sales-marketing';
  if (prompt.includes('architectuur') || prompt.includes('systeemontwerp') || prompt.includes('structuur')) return 'architecture';
  if (prompt.includes('test') || prompt.includes('controleer') || prompt.includes('valideer') || prompt.includes('verificatie')) return 'testing';
  if (prompt.includes('review') || prompt.includes('beoordeel') || prompt.includes('evalueer')) return 'review';
  if (prompt.includes('security scan') || prompt.includes('veiligheidsanalyse') || prompt.includes('beveiligingsmaatregelen')) return 'security-analysis';
  return 'generic';
};

/**
 * Generate a realistic offline response for software development teams
 * @param {string} prompt - The prompt that was sent
 * @returns {string} - A simulated AI response with realistic code or technical content
 */
const generateOfflineResponse = (prompt) => {
  const agentType = detectAgentType(prompt);
  const requestType = detectRequestType(prompt);
  const promptPreview = prompt.length > 100 ? '...' + prompt.slice(-100) : prompt;
  const randomFactor = Math.floor(Math.random() * 3);

  switch (agentType) {
    case 'lead-developer': return generateLeadDeveloperResponse(promptPreview, requestType, randomFactor);
    case 'developer-frontend': return generateDeveloperResponse(promptPreview, 'code-frontend-framework', randomFactor, 'Frontend Developer');
    case 'developer-backend': return generateDeveloperResponse(promptPreview, 'code-generic', randomFactor, 'Backend Developer');
    case 'developer-database': return generateDeveloperResponse(promptPreview, 'code-sql', randomFactor, 'Database Developer');
    case 'developer-mobile': return generateDeveloperResponse(promptPreview, 'code-generic', randomFactor, 'Mobile Developer');
    case 'developer-generic': return generateDeveloperResponse(promptPreview, requestType, randomFactor, 'Developer');
    case 'tester': return generateTesterResponse(promptPreview, requestType, randomFactor);
    case 'designer': return generateDesignerResponse(promptPreview, requestType, randomFactor);
    case 'sales-agent': return generateSalesAgentResponse(promptPreview, requestType, randomFactor);
    case 'devops-engineer': return generateDevOpsResponse(promptPreview, requestType, randomFactor);
    case 'security-expert': return generateSecurityExpertResponse(promptPreview, requestType, randomFactor);
    case 'documentation-writer': return generateDocumentationWriterResponse(promptPreview, requestType, randomFactor);
    default:
      if (requestType.startsWith('code-')) return generateDeveloperResponse(promptPreview, requestType, randomFactor, 'Developer');
      if (requestType === 'testing') return generateTesterResponse(promptPreview, requestType, randomFactor);
      if (requestType === 'architecture') return generateLeadDeveloperResponse(promptPreview, requestType, randomFactor);
      if (requestType === 'design-ui-ux') return generateDesignerResponse(promptPreview, requestType, randomFactor);
      if (requestType === 'sales-marketing') return generateSalesAgentResponse(promptPreview, requestType, randomFactor);
      return generateGenericResponse(promptPreview, randomFactor);
  }
};

const generateGenericResponse = (promptPreview, randomFactor) => {
  const responses = [
    `[OFFLINE MODUS] Generiek antwoord voor: "${promptPreview}". De specifieke agent rol kon niet worden gedetecteerd.`,
    `[OFFLINE MODUS] Dit is een algemeen demo antwoord. Je vroeg: "${promptPreview}".`,
    `[OFFLINE MODUS] Gesimuleerd antwoord op je vraag over "${promptPreview}". Schakel offline modus uit voor echte antwoorden.`
  ];
  return responses[randomFactor % responses.length];
};


const generateLeadDeveloperResponse = (promptPreview, requestType, randomFactor) => {
  if (requestType === 'architecture') {
    const architectureResponses = [
      `Na analyse van de requirements voor "${promptPreview}", stel ik de volgende architectuur voor:
architectuur_document.md
\`\`\`markdown
## Systeemarchitectuur
1.  **Frontend**: React, Redux
2.  **Backend**: Node.js/Express, MongoDB
3.  **Deployment**: Docker, CI/CD met GitHub Actions
\`\`\`
Deze architectuur biedt schaalbaarheid en onderhoudbaarheid.`,
      `Voor het project "${promptPreview}" adviseer ik:
config.yaml
\`\`\`yaml
# Architectuur Beslissingen
microservices: true
eventDriven: true
databaseStrategy:
  transactional: PostgreSQL
  search: Elasticsearch
stack:
  frontend: Vue.js
  services: [Node.js, Python]
\`\`\`
Dit zorgt voor een robuuste, schaalbare oplossing.`,
    ];
    return architectureResponses[randomFactor % architectureResponses.length];
  }
  const leadDeveloperResponses = [
    `Technische beslissingen voor "${promptPreview}":
tech_specs.txt
\`\`\`
- Modulaire architectuur
- RESTful API (Node.js/Express)
- PostgreSQL database
- JWT authenticatie
- Frontend: React + TypeScript
\`\`\``,
  ];
  return leadDeveloperResponses[randomFactor % leadDeveloperResponses.length];
};

const generateDeveloperResponse = (promptPreview, requestType, randomFactor, specialization = 'Developer') => {
  let languageSpecificResponses = [];
  if (requestType === 'code-javascript' || (specialization === 'Frontend Developer' && requestType.startsWith('code-'))) {
    languageSpecificResponses = [
      `Als ${specialization} heb ik de JavaScript-functie voor "${promptPreview}" geschreven:
utils.js
\`\`\`javascript
function exampleJsFunction(param) {
  console.log('Hello from JavaScript!', param);
  return param * 2;
}
\`\`\`
Dit is een basis voorbeeld.`,
      `Als ${specialization} heb ik deze JavaScript code geschreven voor "${promptPreview}":
dataProcessor.js
\`\`\`javascript
const processData = (data) => data.map(item => ({ ...item, processed: true }));
\`\`\`
Deze functie markeert items als verwerkt.`,
    ];
  } else if (requestType === 'code-python' || (specialization === 'Backend Developer' && requestType.startsWith('code-'))) {
    languageSpecificResponses = [
      `Hier is de Python code (als ${specialization}) voor "${promptPreview}":
main.py
\`\`\`python
def example_python_function(param):
  print(f"Hello from Python! {param}")
  return param * 2
\`\`\`
Een basis Python functie.`,
      `Als ${specialization} heb ik deze Python code geschreven voor "${promptPreview}":
api_handler.py
\`\`\`python
class APIHandler:
  def __init__(self, endpoint):
    self.endpoint = endpoint
  def fetch_data(self):
    return {"data": "sample data from " + self.endpoint}
\`\`\`
Een API handler class.`,
    ];
  } else if (requestType === 'code-frontend-framework' || specialization === 'Frontend Developer') {
     languageSpecificResponses = [
      `Als ${specialization} heb ik de volgende React component gemaakt voor "${promptPreview}":
ButtonComponent.jsx
\`\`\`jsx
import React from 'react';
function ButtonComponent({ label, onClick }) {
  return (
    <button onClick={onClick} style={{ padding: '10px', margin: '5px' }}>
      {label}
    </button>
  );
}
export default ButtonComponent;
\`\`\`
Dit is een simpele herbruikbare button.`,
      `Voor "${promptPreview}" heb ik als ${specialization} deze Vue component geschreven:
UserCard.vue
\`\`\`html
<template>
  <div class="user-card">
    <h3>{{ user.name }}</h3>
    <p>Email: {{ user.email }}</p>
  </div>
</template>
<script>
export default { props: { user: Object } }
</script>
<style scoped>.user-card { border: 1px solid #ccc; padding: 1rem; margin: 1rem; }</style>
\`\`\`
Een basis user card component.`
    ];
  } else if (requestType === 'code-sql' || specialization === 'Database Developer') {
    languageSpecificResponses = [
      `Als ${specialization} heb ik de volgende SQL query geschreven voor "${promptPreview}":
query.sql
\`\`\`sql
SELECT id, name, email
FROM users
WHERE age > 30
ORDER BY name ASC;
\`\`\`
Dit haalt actieve gebruikers op.`,
      `Voor "${promptPreview}" heb ik als ${specialization} dit SQL schema ontworpen:
schema.sql
\`\`\`sql
CREATE TABLE IF NOT EXISTS products (
    product_id SERIAL PRIMARY KEY,
    product_name VARCHAR(255) NOT NULL,
    price DECIMAL(10, 2) NOT NULL
);
\`\`\`
Een basis products tabel.`
    ];
  }
  if (languageSpecificResponses.length > 0) {
    return languageSpecificResponses[randomFactor % languageSpecificResponses.length];
  }
  const genericDeveloperResponses = [
    `[OFFLINE MODUS - ${specialization}] Ik heb de code voor "${promptPreview}" geschreven. Hier is een fragment:
placeholder_code.js
\`\`\`javascript
// placeholder_code.js
console.log('Code voor ${promptPreview}');
function placeholder() { return true; }
\`\`\`
Schakel offline modus uit voor echte code.`,
  ];
  return genericDeveloperResponses[randomFactor % genericDeveloperResponses.length];
};

const generateTesterResponse = (promptPreview, requestType, randomFactor) => {
  const testerResponses = [
    `[OFFLINE MODUS - Tester] Ik heb de code voor "${promptPreview}" getest. Resultaten:
test_report.md
\`\`\`markdown
- Unit tests: 15/15 geslaagd
- Integratietests: 8/10 geslaagd (2 kleine bugs gevonden)
- Performance test: Binnen acceptabele limieten
Bugs gerapporteerd: #BUG-123, #BUG-124.
\`\`\`
Schakel offline modus uit voor echte testresultaten.`,
    `[OFFLINE MODUS - Tester] Testrapport voor "${promptPreview}":
functional_tests.txt
\`\`\`
- Functionele tests: Alle hoofdfunctionaliteiten werken zoals verwacht.
- UI tests: Geen visuele afwijkingen gevonden.
Conclusie: Code is goedgekeurd.
\`\`\`
Echte rapporten in online modus.`,
  ];
  return testerResponses[randomFactor % testerResponses.length];
};

const generateDesignerResponse = (promptPreview, requestType, randomFactor) => {
  if (requestType === 'design-ui-ux' || requestType === 'code-web') {
    const designResponses = [
      `[OFFLINE MODUS - Designer] Hier is een HTML/CSS mockup voor "${promptPreview}":
design_mockup.html
\`\`\`html
<div class="container">
  <h1>Mockup</h1>
  <button class="cta-button">Call to Action</button>
</div>
\`\`\`
style.css
\`\`\`css
.container { padding: 20px; border: 1px solid #ccc; }
.cta-button { background-color: #007bff; color: white; padding: 10px; }
\`\`\`
Dit is een concept. Volledig ontwerp in online modus.`,
    ];
    return designResponses[randomFactor % designResponses.length];
  }
  return `[OFFLINE MODUS - Designer] Ik heb nagedacht over het ontwerp voor "${promptPreview}". Focus op gebruiksvriendelijkheid. Details in online modus.`;
};

const generateSalesAgentResponse = (promptPreview, requestType, randomFactor) => {
  const salesResponses = [
    `[OFFLINE MODUS - Sales Agent] Verkooptekst voor "${promptPreview}":
sales_copy.txt
\`\`\`
Ontdek de revolutionaire oplossing! Verhoog uw productiviteit.
\`\`\`
Dit is een concept. Meer overtuigende teksten in online modus.`,
  ];
  return salesResponses[randomFactor % salesResponses.length];
};

const generateDevOpsResponse = (promptPreview, requestType, randomFactor) => {
  if (requestType === 'config-docker' || requestType === 'config-kubernetes' || requestType === 'config-cicd') {
    const devopsConfigResponses = [
      `[OFFLINE MODUS - DevOps] Hier is een basis Dockerfile voor "${promptPreview}":
Dockerfile
\`\`\`dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
\`\`\`
Dit is een startpunt. Volledige configuratie in online modus.`,
    ];
    return devopsConfigResponses[randomFactor % devopsConfigResponses.length];
  }
  return `[OFFLINE MODUS - DevOps] Ik heb de infrastructuur en deployment strategie voor "${promptPreview}" gepland. Details in online modus.`;
};

const generateSecurityExpertResponse = (promptPreview, requestType, randomFactor) => {
  const securityResponses = [
    `[OFFLINE MODUS - Security Expert] Veiligheidsanalyse voor "${promptPreview}":
security_report.md
\`\`\`markdown
- Potentiële risico's: SQL injection, XSS.
- Aanbevolen maatregelen: Input validatie, output encoding.
\`\`\`
Gedetailleerd rapport in online modus.`,
  ];
  return securityResponses[randomFactor % securityResponses.length];
};

const generateDocumentationWriterResponse = (promptPreview, requestType, randomFactor) => {
  if (requestType === 'documentation') {
    const docResponses = [
      `[OFFLINE MODUS - Documentation Writer] API Documentatie (concept) voor "${promptPreview}":
api_docs.md
\`\`\`markdown
## Endpoint: /api/users
- **GET /api/users**: Haalt een lijst van alle gebruikers op.
\`\`\`
Volledige OpenAPI/Swagger specificatie in online modus.`,
    ];
    return docResponses[randomFactor % docResponses.length];
  }
  return `[OFFLINE MODUS - Documentation Writer] Ik ben begonnen met het schrijven van de documentatie voor "${promptPreview}". Details in online modus.`;
};


/**
 * Pause all API requests
 */
export const pauseRequests = () => {
  queueStatus.isPaused = true;
  console.log('API requests paused');
  localStorage.setItem('aiAgentDashboard_requestsPaused', 'true');
};

/**
 * Resume API requests
 */
export const resumeRequests = () => {
  queueStatus.isPaused = false;
  console.log('API requests resumed');
  localStorage.setItem('aiAgentDashboard_requestsPaused', 'false');
  if (requestQueue.length > 0) {
    processQueue();
  }
};

/**
 * Update the API key
 * @param {string} provider - The provider for which to update the key ('openai' or 'anthropic')
 * @param {string} newApiKey - The new API key to use
 * @returns {boolean} - Whether the API key was successfully set
 */
export const updateApiKey = (provider, newApiKey) => {
  const keyInfo = detectApiKeyType(newApiKey);

  if (!keyInfo.valid) {
    console.error('Invalid API key format:', keyInfo.message);
    queueStatus.apiKeyStatus = 'invalid';
    return false;
  }

  if (provider === 'openai') {
    currentOpenAIApiKey = newApiKey;
    localStorage.setItem('aiAgentDashboard_openaiApiKey', newApiKey);
  } else if (provider === 'anthropic') {
    currentClaudeApiKey = newApiKey;
    localStorage.setItem('aiAgentDashboard_claudeApiKey', newApiKey);
  } else {
    console.error(`Unknown provider: ${provider}`);
    return false;
  }

  offlineMode = false;  // Automatically disable offline mode when API key is updated
  localStorage.setItem('aiAgentDashboard_offlineMode', 'false');
  queueStatus.offlineMode = false;
  queueStatus.apiKeyStatus = 'valid';

  console.log(`API key updated for provider: ${provider}`);
  return true;
};

/**
 * Initialize API settings from localStorage and environment variables
 */
export const initializeApiSettings = () => {
  // Try to load API keys from localStorage
  const savedOpenAIApiKey = localStorage.getItem('aiAgentDashboard_openaiApiKey');
  const savedClaudeApiKey = localStorage.getItem('aiAgentDashboard_claudeApiKey');
  const savedOfflineMode = localStorage.getItem('aiAgentDashboard_offlineMode');
  const savedCurrentProvider = localStorage.getItem('aiAgentDashboard_currentProvider');
  const savedCurrentModel = localStorage.getItem('aiAgentDashboard_currentModel');
  const savedOrgId = localStorage.getItem('aiAgentDashboard_orgId');
  const savedBatchMode = localStorage.getItem('aiAgentDashboard_batchMode');

  // Set offline mode first
  if (savedOfflineMode !== null) {
    offlineMode = savedOfflineMode === 'true';
    queueStatus.offlineMode = offlineMode;
  } else {
    // Default to offline mode if no setting is found
    offlineMode = true;
    queueStatus.offlineMode = true;
  }

  // Set provider and model if saved
  if (savedCurrentProvider && AVAILABLE_PROVIDERS[savedCurrentProvider]) {
    currentProvider = savedCurrentProvider;
    queueStatus.currentProvider = savedCurrentProvider;
    queueStatus.availableModels = AVAILABLE_PROVIDERS[savedCurrentProvider].models;
  }

  // Set model if saved and valid for current provider
  if (savedCurrentModel && AVAILABLE_PROVIDERS[currentProvider].models[savedCurrentModel]) {
    currentModel = savedCurrentModel;
    queueStatus.currentModel = savedCurrentModel;
  } else {
    // Default to provider's default model
    currentModel = AVAILABLE_PROVIDERS[currentProvider].defaultModel;
    queueStatus.currentModel = currentModel;
  }

  // Set API keys if saved
  if (savedOpenAIApiKey) {
    currentOpenAIApiKey = savedOpenAIApiKey;
    if (!offlineMode && currentProvider === 'openai') {
      queueStatus.apiKeyStatus = 'valid'; // Assume valid until proven otherwise
    }
  }

  if (savedClaudeApiKey) {
    currentClaudeApiKey = savedClaudeApiKey;
    if (!offlineMode && currentProvider === 'anthropic') {
      queueStatus.apiKeyStatus = 'valid'; // Assume valid until proven otherwise
    }
  }

  // Set organization ID if saved
  if (savedOrgId) {
    currentOrgId = savedOrgId;
  }

  // Set batch mode if saved
  if (savedBatchMode !== null) {
    queueStatus.batchMode = savedBatchMode === 'true';
  }

  console.log('API settings initialized:',
    'Provider:', currentProvider,
    'Model:', currentModel,
    'Offline mode:', offlineMode,
    'Has OpenAI API key:', !!currentOpenAIApiKey,
    'Has Claude API key:', !!currentClaudeApiKey,
    'Has Org ID:', !!currentOrgId,
    'Batch mode:', queueStatus.batchMode
  );

  return {
    provider: currentProvider,
    model: currentModel,
    offlineMode: offlineMode,
    hasOpenAIKey: !!currentOpenAIApiKey,
    hasClaudeKey: !!currentClaudeApiKey,
    hasOrgId: !!currentOrgId,
    batchMode: queueStatus.batchMode
  };
};

/**
 * Process the request queue with rate limiting
 */
const processQueue = async () => {
  if (isProcessingQueue || requestQueue.length === 0 || queueStatus.isPaused) return;
  if (Date.now() < cooldownUntil) {
    queueStatus.cooldownRemaining = cooldownUntil - Date.now();
    console.log(`In cooldown period. ${Math.ceil(queueStatus.cooldownRemaining / 1000)}s remaining.`);
    setTimeout(processQueue, Math.min(5000, queueStatus.cooldownRemaining));
    return;
  }
  isProcessingQueue = true;
  queueStatus.currentlyProcessing = true;
  const now = Date.now();
  const timeToWait = Math.max(0, MIN_REQUEST_INTERVAL - (now - lastRequestTime));
  if (timeToWait > 0) {
    queueStatus.estimatedTimeRemaining = timeToWait;
    console.log(`Rate limiting: Waiting ${timeToWait}ms before next request`);
    await new Promise(resolve => setTimeout(resolve, timeToWait));
  }
  if (queueStatus.batchMode && requestQueue.length > 1) {
    await processBatch();
  } else {
    const { prompt, resolve: queueResolve, reject: queueReject } = requestQueue.shift();
    try {
      console.log(`Processing request: ${prompt.substring(0, 50)}...`);
      let result;
      if (offlineMode) {
        console.log('Using offline mode - generating demo response');
        await new Promise(resolve => setTimeout(resolve, 500));
        result = generateOfflineResponse(prompt);
      } else {
        const apiKeyToUse = currentProvider === 'openai' ? currentOpenAIApiKey : currentClaudeApiKey;
        result = await executeApiCall(prompt, apiKeyToUse);
      }
      queueResolve(result);
      if (queueStatus.rateLimitHit) {
        queueStatus.rateLimitHit = false;
        queueStatus.apiKeyStatus = 'valid';
      }
      failedApiCallsCount = 0;
    } catch (error) {
      console.error(`Request failed: ${error.message}`);
      queueReject(error);
      if (error.message.includes('rate limit') || error.message.includes('429')) {
        failedApiCallsCount++;
        updateApiCallStats('rateLimit');
        enterCooldownPeriod();
      } else {
        failedApiCallsCount++;
        updateApiCallStats('fail');
      }
      if (failedApiCallsCount >= MAX_FAILED_CALLS_BEFORE_FALLBACK && !offlineMode) {
        console.warn(`Automatically switching to offline mode after ${MAX_FAILED_CALLS_BEFORE_FALLBACK} failed API calls`);
        setOfflineMode(true);
      }
    } finally {
      lastRequestTime = Date.now();
      isProcessingQueue = false;
      queueStatus.currentlyProcessing = false;
      queueStatus.estimatedTimeRemaining = requestQueue.length * MIN_REQUEST_INTERVAL;
      setTimeout(processQueue, 100);
    }
  }
};

/**
 * Enter a cooldown period after rate limit
 */
const enterCooldownPeriod = () => {
  cooldownUntil = Date.now() + COOLDOWN_PERIOD;
  queueStatus.rateLimitHit = true;
  queueStatus.apiKeyStatus = 'rate_limited';
  queueStatus.cooldownRemaining = COOLDOWN_PERIOD;
  console.warn(`Entering cooldown period for ${COOLDOWN_PERIOD/1000} seconds due to rate limiting`);
};

/**
 * Process multiple similar requests in a batch
 */
const processBatch = async () => {
  console.log(`Batch processing ${Math.min(BATCH_SIZE, requestQueue.length)} requests`);
  const batch = requestQueue.splice(0, BATCH_SIZE);
  const apiKeyToUse = currentProvider === 'openai' ? currentOpenAIApiKey : currentClaudeApiKey;

  try {
    for (let i = 0; i < batch.length; i++) {
      const { prompt, resolve } = batch[i];
      try {
        let result;
        if (offlineMode) {
          console.log('Using offline mode - generating demo response');
          await new Promise(resolve => setTimeout(resolve, 500));
          result = generateOfflineResponse(prompt);
        } else {
          result = await executeApiCall(prompt, apiKeyToUse);
        }
        resolve(result);
        if (queueStatus.rateLimitHit) {
          queueStatus.rateLimitHit = false;
          queueStatus.apiKeyStatus = 'valid';
        }
        failedApiCallsCount = 0;
      } catch (error) {
        console.warn(`Batch item ${i} failed: ${error.message}`);
        batch[i].reject(error);
        if (error.message.includes('rate limit') || error.message.includes('429')) {
          failedApiCallsCount++;
          updateApiCallStats('rateLimit');
          enterCooldownPeriod();
          requestQueue.unshift(...batch.slice(i + 1));
          break;
        } else {
          failedApiCallsCount++;
          updateApiCallStats('fail');
        }
        if (failedApiCallsCount >= MAX_FAILED_CALLS_BEFORE_FALLBACK && !offlineMode) {
          console.warn(`Automatically switching to offline mode after ${MAX_FAILED_CALLS_BEFORE_FALLBACK} failed API calls`);
          setOfflineMode(true);
          break;
        }
      }
      if (i < batch.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  } finally {
    lastRequestTime = Date.now();
    isProcessingQueue = false;
    queueStatus.currentlyProcessing = false;
    queueStatus.estimatedTimeRemaining = requestQueue.length * MIN_REQUEST_INTERVAL;
    setTimeout(processQueue, MIN_REQUEST_INTERVAL);
  }
};

/**
 * Execute the actual API call with retry logic
 * @param {string} prompt - The prompt to send to the API
 * @param {string} apiKey - The API key for the current provider
 * @returns {Promise<string>} - The API response
 */
const executeApiCall = async (prompt, apiKey, retryCount = 0) => {
  if (offlineMode) {
    console.log('Offline mode active in executeApiCall - returning demo response');
    return generateOfflineResponse(prompt);
  }
  const keyInfo = detectApiKeyType(apiKey);
  if (!keyInfo.valid) {
    console.error(`Invalid API key format: ${keyInfo.message}`);
    queueStatus.apiKeyStatus = 'invalid';
    queueStatus.lastError = keyInfo.message;
    throw new Error(keyInfo.message);
  }
  console.log(`Using API key type: ${keyInfo.type} for provider: ${currentProvider}`);
  const MAX_RETRIES = 4;
  const RETRY_DELAYS = [3000, 7000, 15000, 30000];

  try {
    console.log(`Sending request to ${currentProvider} API (attempt ${retryCount + 1}/${MAX_RETRIES + 1}) using model ${currentModel}`);
    updateApiCallStats('total');

    let response;
    if (currentProvider === 'openai') {
      const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      };
      if (keyInfo.type === 'openai-project') {
        headers["OpenAI-Beta"] = "assistants=v1"; // Example, might not be needed for chat completions
      }
      if (currentOrgId) {
        headers["OpenAI-Organization"] = currentOrgId;
      }
      const debugHeaders = {...headers}; delete debugHeaders.Authorization; console.log('Request headers (OpenAI):', debugHeaders);

      response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: headers,
        body: JSON.stringify({ model: currentModel, messages: [{ role: "user", content: prompt }] })
      });
    } else if (currentProvider === 'anthropic') {
      const headers = {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      };
      const debugHeaders = {...headers}; delete debugHeaders["x-api-key"]; console.log('Request headers (Anthropic):', debugHeaders);

      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: headers,
        body: JSON.stringify({ model: currentModel, max_tokens: 1024, messages: [{ role: "user", content: prompt }] })
      });
    } else {
      throw new Error(`Unsupported provider: ${currentProvider}`);
    }

    console.log(`Response Status: ${response.status} ${response.statusText}`);
    const responseHeaders = {};
    response.headers.forEach((value, name) => { responseHeaders[name] = value; });
    console.log('Response Headers:', responseHeaders);

    const responseBody = await response.json();
    console.log('Response Body:', JSON.stringify(responseBody, null, 2));

    if (response.status === 429) {
      queueStatus.rateLimitHit = true;
      queueStatus.apiKeyStatus = 'rate_limited';
      queueStatus.lastError = 'Rate limit exceeded';
      updateApiCallStats('rateLimit');
      failedApiCallsCount++;
      const retryAfter = response.headers.get('retry-after') || RETRY_DELAYS[retryCount];
      const waitTime = parseInt(retryAfter, 10) * 1000 || RETRY_DELAYS[retryCount];
      console.warn(`Rate limited. Retrying after ${waitTime/1000} seconds...`);
      if (failedApiCallsCount >= MAX_FAILED_CALLS_BEFORE_FALLBACK && !offlineMode) {
        console.warn(`Automatically switching to offline mode after ${MAX_FAILED_CALLS_BEFORE_FALLBACK} failed API calls`);
        setOfflineMode(true);
        return generateOfflineResponse(prompt);
      }
      if (retryCount < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return executeApiCall(prompt, apiKey, retryCount + 1);
      } else {
        enterCooldownPeriod();
        throw new Error('Rate limit exceeded. Maximum retries reached. Please try again later.');
      }
    } else if (response.status === 401 || response.status === 403) {
      queueStatus.apiKeyStatus = 'invalid';
      queueStatus.lastError = 'Invalid API key or insufficient permissions';
      let errorDetails = responseBody.error?.message || '';
      console.error('Authentication error details:', responseBody);
      updateApiCallStats('fail');
      failedApiCallsCount++;
      throw new Error(`Authentication failed: ${errorDetails || 'Please check if your API key is correct and has the necessary permissions.'}`);
    }
    if (!response.ok) {
      const errorMessage = responseBody.error?.message || `HTTP ${response.status}: ${response.statusText}`;
      queueStatus.lastError = errorMessage;
      updateApiCallStats('fail');
      failedApiCallsCount++;
      throw new Error(errorMessage);
    }
    queueStatus.rateLimitHit = false;
    queueStatus.apiKeyStatus = 'valid';
    updateApiCallStats('success');
    failedApiCallsCount = 0;

    if (currentProvider === 'openai') {
      return responseBody.choices?.[0]?.message?.content || "[Geen antwoord van OpenAI]";
    } else if (currentProvider === 'anthropic') {
      // Anthropic's response structure is different
      if (responseBody.content && responseBody.content.length > 0 && responseBody.content[0].type === 'text') {
        return responseBody.content[0].text || "[Geen antwoord van Claude]";
      }
      return "[Claude antwoordde in een onverwacht formaat]";
    }
  } catch (err) {
    // Catch-all for network errors or other issues not handled above
    console.error("AI request error:", err);
    queueStatus.lastError = err.message;
    updateApiCallStats('fail');
    failedApiCallsCount++;
    if (err.message.includes('Rate limit') || err.message.includes('429')) { // Double check for rate limit in catch
        if (retryCount < MAX_RETRIES) {
            const waitTime = RETRY_DELAYS[retryCount];
            console.warn(`Rate limited (caught in general catch). Retrying after ${waitTime/1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            return executeApiCall(prompt, apiKey, retryCount + 1);
        }
        enterCooldownPeriod();
    }
    if (failedApiCallsCount >= MAX_FAILED_CALLS_BEFORE_FALLBACK && !offlineMode) {
        console.warn(`Automatically switching to offline mode after ${MAX_FAILED_CALLS_BEFORE_FALLBACK} failed API calls (in catch)`);
        setOfflineMode(true);
        return generateOfflineResponse(prompt); // Return offline response if auto-switching
    }
    throw new Error(`API Error: ${err.message}`);
  }
};

/**
 * Queue an API request and return a promise
 * @param {string} prompt - The prompt to send to the API
 * @returns {Promise<string>} - The API response
 */
export const callAgentTask = (prompt) => {
  if (offlineMode) {
    console.log('Using offline mode - generating immediate demo response');
    return Promise.resolve(generateOfflineResponse(prompt));
  }

  const apiKeyToUse = currentProvider === 'openai' ? currentOpenAIApiKey : currentClaudeApiKey;

  if (!apiKeyToUse) {
    console.error(`No API key found for provider ${currentProvider}. Please add your API key.`);
    return Promise.resolve(`[ERROR] No API key found for ${currentProvider}. Please add your API key.`);
  }

  const keyInfo = detectApiKeyType(apiKeyToUse);
  if (!keyInfo.valid) {
    console.error(`Invalid API key format for ${currentProvider}: ${keyInfo.message}`);
    return Promise.resolve(`[ERROR] ${keyInfo.message}`);
  }

  queueStatus.totalQueued++;
  queueStatus.estimatedTimeRemaining = requestQueue.length * MIN_REQUEST_INTERVAL;

  return new Promise((resolve, reject) => {
    requestQueue.push({
      prompt,
      resolve: (result) => {
        queueStatus.totalQueued = Math.max(0, queueStatus.totalQueued - 1);
        resolve(result);
      },
      reject: (error) => {
        queueStatus.totalQueued = Math.max(0, queueStatus.totalQueued - 1);
        if (error.message.includes('rate limit') || error.message.includes('429')) {
          resolve(`[FOUT] API rate limit bereikt. Wacht ${Math.ceil(COOLDOWN_PERIOD/1000)} seconden en probeer opnieuw. (HTTP 429)`);
        } else if (error.message.includes('Invalid API key') || error.message.includes('authentication failed')) {
          resolve(`[FOUT] Ongeldige API sleutel of onvoldoende rechten. Controleer je API sleutel en probeer opnieuw.`);
        } else {
          resolve(`[FOUT] ${error.message}`);
        }
      }
    });
    if (!queueStatus.isPaused && Date.now() >= cooldownUntil) {
      processQueue();
    } else if (Date.now() < cooldownUntil) {
      console.log(`Request queued. Currently in cooldown period (${Math.ceil((cooldownUntil - Date.now())/1000)}s remaining)`);
    } else {
      console.log('Request queued. Processing paused.');
    }
  });
};

// Initialize settings on module load
initializeApiSettings();
