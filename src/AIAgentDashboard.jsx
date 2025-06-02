import { useState, useEffect } from 'react';
import { Input } from "./components/ui/input";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import AgentCard from './AgentCard';
import AgentFlowchart from './AgentFlowchart';
import {
  callAgentTask,
  getQueueStatus,
  setBatchMode,
  pauseRequests,
  resumeRequests,
  updateApiKey,
  setModel,
  // getAvailableModels, // Not directly used, getQueueStatus provides it
  resetApiStatus,
  setOfflineMode,
  setOrganizationId,
  setProvider,
  initializeApiSettings
} from './useAgentAPI';
import { generateId } from './utils';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

export default function AIAgentDashboard() {
  const [agents, setAgents] = useState([]);
  const [mainInput, setMainInput] = useState('');
  const [newAgentName, setNewAgentName] = useState('');
  const [loadingAgentId, setLoadingAgentId] = useState(null);
  const [showFlowchart, setShowFlowchart] = useState(false);
  const [flowchartNodes, setFlowchartNodes] = useState([]);
  const [flowchartEdges, setFlowchartEdges] = useState([]);
  const [showResetConfirmation, setShowResetConfirmation] = useState(false);

  // API Modal State
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [openaiApiKeyInput, setOpenaiApiKeyInput] = useState('');
  const [claudeApiKeyInput, setClaudeApiKeyInput] = useState('');
  const [selectedProviderForModal, setSelectedProviderForModal] = useState('openai');
  const [apiKeySaveSuccess, setApiKeySaveSuccess] = useState(false);
  const [orgIdInput, setOrgIdInput] = useState('');

  const [manualApproval, setManualApproval] = useState(false);
  const [pendingMessages, setPendingMessages] = useState([]);
  const [generatedCodeBlocks, setGeneratedCodeBlocks] = useState([]);
  const [showClearCodeConfirmation, setShowClearCodeConfirmation] = useState(false);

  const [queueStatus, setQueueStatus] = useState({
    queueLength: 0,
    totalQueued: 0,
    currentlyProcessing: false,
    estimatedTimeRemaining: 0,
    lastError: null,
    rateLimitHit: false,
    isPaused: false,
    cooldownRemaining: 0,
    apiKeyStatus: 'unknown',
    currentProvider: 'openai',
    currentModel: 'gpt-3.5-turbo',
    availableModels: {},
    availableProviders: {},
    offlineMode: true, // Default to true
    hasOrgId: false,
    apiCallStats: { total: 0, successful: 0, failed: 0, rateLimited: 0, lastReset: Date.now() }
  });
  const [batchMode, setBatchModeEnabled] = useState(false);
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY || "YOUR_OPENAI_API_KEY"; // Updated for Vite

  // Load agents and settings from localStorage on component mount
  useEffect(() => {
    // Initialize API settings from localStorage
    const apiSettings = initializeApiSettings();

    const initialStatus = getQueueStatus();
    setQueueStatus(initialStatus);
    setBatchModeEnabled(initialStatus.batchMode); // Sync local state with useAgentAPI state
    setManualApproval(localStorage.getItem('aiAgentDashboard_manualApproval') === 'true');

    // Load agents
    const savedAgents = localStorage.getItem('aiAgentDashboard_agents');
    if (savedAgents) {
      try {
        const parsedAgents = JSON.parse(savedAgents);
        if (parsedAgents.length > 0 && !parsedAgents.some(a => a.isMainAgent)) {
          parsedAgents[0].isMainAgent = true;
        }
        setAgents(parsedAgents);
      } catch (error) {
        console.error('Error loading saved agents:', error);
      }
    }

    const savedFlowchartVisibility = localStorage.getItem('aiAgentDashboard_showFlowchart');
    if (savedFlowchartVisibility !== null) {
      setShowFlowchart(savedFlowchartVisibility === 'true');
    }

    const savedOrgId = localStorage.getItem('aiAgentDashboard_orgId');
    if (savedOrgId) {
      setOrgIdInput(savedOrgId);
    }

    const savedCodeBlocks = localStorage.getItem('aiAgentDashboard_generatedCode');
    if (savedCodeBlocks) {
      try {
        setGeneratedCodeBlocks(JSON.parse(savedCodeBlocks));
      } catch (error) {
        console.error('Error loading saved code blocks:', error);
      }
    }

    // Show API key modal if needed
    if (!initialStatus.offlineMode) {
      const hasOpenAIApiKey = localStorage.getItem('aiAgentDashboard_openaiApiKey');
      const hasClaudeApiKey = localStorage.getItem('aiAgentDashboard_claudeApiKey');
      if ((initialStatus.currentProvider === 'openai' && !hasOpenAIApiKey) ||
          (initialStatus.currentProvider === 'anthropic' && !hasClaudeApiKey)) {
        setSelectedProviderForModal(initialStatus.currentProvider);
        openApiKeyModal();
      }
    }
  }, []); // Empty dependency array ensures this runs only once on mount

  useEffect(() => {
    if (agents.length > 0 || localStorage.getItem('aiAgentDashboard_agents')) {
      localStorage.setItem('aiAgentDashboard_agents', JSON.stringify(agents));
    }
  }, [agents]);

  useEffect(() => {
    localStorage.setItem('aiAgentDashboard_showFlowchart', showFlowchart.toString());
  }, [showFlowchart]);

  useEffect(() => {
    localStorage.setItem('aiAgentDashboard_batchMode', batchMode.toString());
    // No need to call setBatchMode from useAgentAPI here, toggleBatchMode does that.
  }, [batchMode]);

  useEffect(() => {
    localStorage.setItem('aiAgentDashboard_manualApproval', manualApproval.toString());
  }, [manualApproval]);

  useEffect(() => {
    localStorage.setItem('aiAgentDashboard_generatedCode', JSON.stringify(generatedCodeBlocks));
  }, [generatedCodeBlocks]);

  useEffect(() => {
    const intervalId = setInterval(() => setQueueStatus(getQueueStatus()), 1000);
    return () => clearInterval(intervalId);
  }, []);

  const toggleBatchMode = () => {
    const newMode = !batchMode;
    setBatchModeEnabled(newMode); // Update local React state
    setBatchMode(newMode); // Update useAgentAPI module state
  };

  const toggleManualApproval = () => {
    setManualApproval(!manualApproval);
  };

  const toggleOfflineMode = () => {
    setOfflineMode(!queueStatus.offlineMode);
  };

  const handleResetApiStatus = () => {
    resetApiStatus();
  };

  const togglePauseRequests = () => {
    if (queueStatus.isPaused) {
      resumeRequests();
    } else {
      pauseRequests();
    }
  };

  const openApiKeyModal = () => {
    setOpenaiApiKeyInput(localStorage.getItem('aiAgentDashboard_openaiApiKey') || '');
    setClaudeApiKeyInput(localStorage.getItem('aiAgentDashboard_claudeApiKey') || '');
    setOrgIdInput(localStorage.getItem('aiAgentDashboard_orgId') || '');
    setSelectedProviderForModal(queueStatus.currentProvider);
    setApiKeySaveSuccess(false);
    setShowApiKeyModal(true);
  };

  const handleApiKeySubmit = (e) => {
    e.preventDefault();
    let keyToSave = selectedProviderForModal === 'openai' ? openaiApiKeyInput : claudeApiKeyInput;

    if (keyToSave.trim()) {
      if (updateApiKey(selectedProviderForModal, keyToSave.trim())) {
        // Save API key to localStorage
        if (selectedProviderForModal === 'openai') {
          localStorage.setItem('aiAgentDashboard_openaiApiKey', openaiApiKeyInput.trim());
        } else if (selectedProviderForModal === 'anthropic') {
          localStorage.setItem('aiAgentDashboard_claudeApiKey', claudeApiKeyInput.trim());
        }

        // Save organization ID if provided
        if (orgIdInput.trim()) {
          localStorage.setItem('aiAgentDashboard_orgId', orgIdInput.trim());
          setOrganizationId(orgIdInput.trim());
        }

        setApiKeySaveSuccess(true);
        setTimeout(() => {
          setApiKeySaveSuccess(false);
          setShowApiKeyModal(false);
        }, 2000);
      } else {
        alert(`API sleutel voor ${selectedProviderForModal} is ongeldig. Controleer het formaat.`);
      }
    }
  };

  const handleProviderChangeInModal = (e) => {
    setSelectedProviderForModal(e.target.value);
  };

  const handleProviderChange = (e) => {
    const newProvider = e.target.value;
    setProvider(newProvider);
    setQueueStatus(getQueueStatus());
  };

  const handleModelChange = (e) => {
    const newModel = e.target.value;
    setModel(newModel);
    setQueueStatus(getQueueStatus());
  };

  useEffect(() => {
    const nodes = agents.map((agent, index) => ({
      id: agent.id,
      position: { x: 100 + (index * 250), y: 100 + (index % 2 * 100) },
      data: { label: `${agent.name}${agent.isMainAgent ? ' (Hoofd)' : ''}` },
      type: 'default',
      style: agent.isMainAgent ? { backgroundColor: '#d1fae5', borderColor: '#10b981', fontWeight: 'bold' } : {}
    }));
    const edges = agents
      .filter(agent => agent.forwardTo)
      .map(agent => ({
        id: `${agent.id}-${agent.forwardTo}`,
        source: agent.id,
        target: agent.forwardTo,
        animated: true,
        label: 'Stuurt door naar'
      }));
    setFlowchartNodes(nodes);
    setFlowchartEdges(edges);
  }, [agents]);

  const addAgent = () => {
    if (newAgentName.trim() === '') return;

    const newAgent = {
      id: generateId(),
      name: newAgentName.trim(),
      task: '',
      forwardTo: null,
      messages: [],
      isMainAgent: agents.length === 0
    };

    const updatedAgents = [...agents, newAgent];
    setAgents(updatedAgents);
    setNewAgentName('');

    // Save agents to localStorage
    localStorage.setItem('aiAgentDashboard_agents', JSON.stringify(updatedAgents));
  };

  const removeAgent = (id) => {
    setAgents(prevAgents => {
      const remainingAgents = prevAgents.filter(agent => agent.id !== id);
      if (prevAgents.find(a => a.id === id)?.isMainAgent && remainingAgents.length > 0 && !remainingAgents.some(a => a.isMainAgent)) {
        remainingAgents[0].isMainAgent = true;
      }
      return remainingAgents;
    });
  };

  const updateForwarding = (agentId, toId) => {
    setAgents(agents.map(agent => agent.id === agentId ? { ...agent, forwardTo: toId } : agent));
  };

  const updateTask = (agentId, task) => {
    setAgents(agents.map(agent => agent.id === agentId ? { ...agent, task } : agent));
  };

  const setAsMainAgent = (agentId) => {
    setAgents(prevAgents =>
      prevAgents.map(agent => ({
        ...agent,
        isMainAgent: agent.id === agentId
      }))
    );
  };

  const moveAgentUp = (agentId) => {
    setAgents(prevAgents => {
      const index = prevAgents.findIndex(agent => agent.id === agentId);
      if (index > 0) {
        const newAgents = [...prevAgents];
        [newAgents[index - 1], newAgents[index]] = [newAgents[index], newAgents[index - 1]];
        return newAgents;
      }
      return prevAgents;
    });
  };

  const moveAgentDown = (agentId) => {
    setAgents(prevAgents => {
      const index = prevAgents.findIndex(agent => agent.id === agentId);
      if (index < prevAgents.length - 1 && index !== -1) {
        const newAgents = [...prevAgents];
        [newAgents[index + 1], newAgents[index]] = [newAgents[index], newAgents[index + 1]];
        return newAgents;
      }
      return prevAgents;
    });
  };

  const inferFilename = (promptText, agentName, language, index) => {
    const filenameRegex = /file named\s+['"]?([\w.-]+)['"]?|create\s+['"]?([\w.-]+)['"]?/i;
    const match = promptText.match(filenameRegex);
    if (match && (match[1] || match[2])) {
      return match[1] || match[2];
    }
    const langExtension = language || 'txt';
    return `${agentName.toLowerCase().replace(/\s+/g, '_')}_output_${index + 1}.${langExtension}`;
  };

  const deliverMessage = async (agentId, from, text) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;

    setLoadingAgentId(agentId);

    const augmentedPrompt = `${agent.task || 'Voer je taak uit op basis van deze input:'}
    \nInput van ${from}: ${text}
    \n\nInstructie: Als je code genereert, specificeer dan een bestandsnaam in het formaat \`bestandsnaam.ext\` direct voor het codeblok.`;

    const aiResponse = await callAgentTask(augmentedPrompt);
    setLoadingAgentId(null);

    // Maak sure messages array bestaat voordat we die updaten
    const messages = agent.messages || [];
    const updatedAgent = {
      ...agent,
      messages: [...messages, { from, text }, { from: agent.name, text: aiResponse }]
    };

    setAgents(prev => prev.map(a => a.id === agentId ? updatedAgent : a));

    const codeBlockRegex = /([\w.-]+)\s*\n?\`\`\`(\w+)?\n([\s\S]*?)\n\`\`\`|```(\w+)?\n([\s\S]*?)\n```/g;
    let match;
    let newCodeBlocks = [];

    while ((match = codeBlockRegex.exec(aiResponse)) !== null) {
      let filename, language, code;
      if (match[1]) {
        filename = match[1];
        language = match[2] || 'txt';
        code = match[3].trim();
      } else {
        language = match[4] || 'txt';
        code = match[5].trim();
        filename = inferFilename(text, agent.name, language, generatedCodeBlocks.length + newCodeBlocks.length);
      }
      newCodeBlocks.push({
        id: generateId(),
        agentId: agent.id,
        agentName: agent.name,
        filename,
        language,
        code,
        timestamp: Date.now()
      });
    }

    if (newCodeBlocks.length > 0) {
      setGeneratedCodeBlocks(prev => [...prev, ...newCodeBlocks]);
    }

    if (agent.forwardTo && !manualApproval) {
      setTimeout(() => deliverMessage(agent.forwardTo, agent.name, aiResponse), 1500);
    } else if (agent.forwardTo && manualApproval) {
      setPendingMessages(prev => [...prev, {
        id: generateId(),
        fromAgentId: agent.id,
        fromAgentName: agent.name,
        toAgentId: agent.forwardTo,
        toAgentName: agents.find(a => a.id === agent.forwardTo)?.name || 'Onbekend',
        message: aiResponse,
        timestamp: Date.now()
      }]);
    }
  };

  const approveMessage = (messageId) => {
    const message = pendingMessages.find(m => m.id === messageId);
    if (!message) return;
    setPendingMessages(prev => prev.filter(m => m.id !== messageId));
    deliverMessage(message.toAgentId, message.fromAgentName, message.message);
  };

  const rejectMessage = (messageId) => {
    setPendingMessages(prev => prev.filter(m => m.id !== messageId));
  };

  const sendToMainAgent = () => {
    const mainAgent = agents.find(agent => agent.isMainAgent);
    if (!mainInput || !mainAgent) return;
    deliverMessage(mainAgent.id, 'user', mainInput);
    setMainInput('');
  };

  const openResetConfirmation = () => setShowResetConfirmation(true);

  const resetAgents = () => {
    setAgents([]);
    localStorage.removeItem('aiAgentDashboard_agents');
    setGeneratedCodeBlocks([]);
    setShowResetConfirmation(false);
  };

  const formatTime = (ms) => {
    if (!ms) return '0s';
    return `${Math.ceil(ms / 1000)}s`;
  };

  const getApiKeyStatusColor = () => {
    switch (queueStatus.apiKeyStatus) {
      case 'valid': return 'bg-green-500';
      case 'invalid': return 'bg-red-500';
      case 'rate_limited': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getApiKeyStatusText = () => {
    switch (queueStatus.apiKeyStatus) {
      case 'valid': return 'Geldig';
      case 'invalid': return 'Ongeldig';
      case 'rate_limited': return 'Rate limited';
      default: return 'Onbekend';
    }
  };

  const handleDownloadCode = () => {
    if (generatedCodeBlocks.length === 0) {
      alert("Nog geen code gegenereerd om te downloaden."); return;
    }
    const zip = new JSZip();
    generatedCodeBlocks.forEach(block => {
      const validFilename = block.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      zip.file(validFilename, block.code);
    });
    zip.generateAsync({ type: "blob" })
      .then(content => saveAs(content, "ai_generated_project.zip"))
      .catch(err => { console.error("Fout bij het genereren van zip:", err); alert("Fout bij het downloaden."); });
  };

  const handleClearGeneratedCode = () => {
    setGeneratedCodeBlocks([]);
    setShowClearCodeConfirmation(false);
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text)
      .then(() => alert('Code gekopieerd!'))
      .catch(err => { console.error('Kon niet kopiëren: ', err); alert('Kopiëren mislukt.'); });
  };

  const mainAgentName = agents.find(a => a.isMainAgent)?.name || 'geen hoofdagent';

  return (
    <div className="p-4 grid gap-6">
      <header className="bg-gradient-to-r from-blue-500 to-purple-600 text-white p-4 rounded-xl shadow-lg">
        <h1 className="text-2xl font-bold">AI Agent Dashboard</h1>
        <p className="opacity-80">Orchestrate and chain multiple AI agents for complex tasks</p>
      </header>

      <div className="bg-gray-50 border rounded-lg p-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${queueStatus.offlineMode ? 'bg-blue-500' : queueStatus.rateLimitHit ? 'bg-red-500' : queueStatus.currentlyProcessing ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`}></div>
            <span className="text-sm font-medium">API Status:</span>
            <span className="text-sm">
              {queueStatus.offlineMode ? 'Offline modus' :
               queueStatus.rateLimitHit ? 'Rate limit bereikt' :
               queueStatus.currentlyProcessing ? 'Verwerken...' : 'Gereed'}
            </span>
          </div>
          <div className="text-sm"><span className="font-medium">Wachtrij:</span> {queueStatus.queueLength} verzoeken</div>
          {queueStatus.estimatedTimeRemaining > 0 && !queueStatus.offlineMode && (
            <div className="text-sm"><span className="font-medium">Wachttijd:</span> ~{formatTime(queueStatus.estimatedTimeRemaining)}</div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t pt-2">
          <div>
            {queueStatus.cooldownRemaining > 0 && !queueStatus.offlineMode ? (
              <div className="text-sm text-red-600">
                <span className="font-medium">Cooldown:</span> {formatTime(queueStatus.cooldownRemaining)} resterend
                <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1"><div className="bg-red-600 h-1.5 rounded-full" style={{ width: `${Math.min(100, (queueStatus.cooldownRemaining / 60000) * 100)}%` }}></div></div>
              </div>
            ) : queueStatus.lastError && !queueStatus.offlineMode ? (
              <div className="text-sm text-red-600"><span className="font-medium">Laatste fout:</span> {queueStatus.lastError}</div>
            ) : queueStatus.offlineMode ? (
              <div className="text-sm text-blue-600"><span className="font-medium">Offline modus actief:</span> Geen API-verzoeken.</div>
            ) : null}
          </div>
          <div className="flex items-center gap-2 justify-end">
            <div className={`w-2 h-2 rounded-full mr-1 ${queueStatus.offlineMode ? 'bg-blue-500' : getApiKeyStatusColor()}`}></div>
            <span className="text-sm"><span className="font-medium">API sleutel:</span> {queueStatus.offlineMode ? 'Niet gebruikt' : getApiKeyStatusText()}</span>
            <Button onClick={openApiKeyModal} variant="outline" size="sm" className="text-xs" disabled={queueStatus.offlineMode}>Wijzig API sleutel</Button>
            <Button onClick={togglePauseRequests} variant="outline" size="sm" className={`${queueStatus.isPaused ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"} text-xs`} disabled={queueStatus.offlineMode}>
              {queueStatus.isPaused ? "Hervat" : "Pauzeer"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t pt-2 mt-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Provider:</span>
            <select value={queueStatus.currentProvider} onChange={handleProviderChange} className="text-sm border rounded px-2 py-1 flex-grow" disabled={queueStatus.offlineMode}>
              {Object.entries(queueStatus.availableProviders || {}).map(([id, provider]) => (
                <option key={id} value={id}>{provider.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">AI Model:</span>
            <select value={queueStatus.currentModel} onChange={handleModelChange} className="text-sm border rounded px-2 py-1 flex-grow" disabled={queueStatus.offlineMode}>
              {Object.entries(queueStatus.availableModels || {}).map(([id, model]) => (
                <option key={id} value={id}>{model.name} - {model.description}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 justify-end">
            <span className="text-sm font-medium">Batch modus:</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={batchMode} onChange={toggleBatchMode} disabled={queueStatus.offlineMode} />
              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t pt-2 mt-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Offline modus:</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={queueStatus.offlineMode} onChange={toggleOfflineMode} />
              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
             <span className="text-xs text-gray-500">{queueStatus.offlineMode ? "Aan (demo)" : "Uit (echte API)"}</span>
          </div>
           <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Handmatige goedkeuring:</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={manualApproval} onChange={toggleManualApproval} />
              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
            <span className="text-xs text-gray-500">{manualApproval ? "Aan" : "Uit"}</span>
          </div>
          <div className="flex items-center gap-2 justify-end">
            <Button onClick={handleResetApiStatus} variant="outline" size="sm" className="bg-yellow-100 text-yellow-700 text-xs" disabled={queueStatus.offlineMode}>Reset API Status</Button>
          </div>
        </div>
      </div>

      <div className="flex gap-2 items-center">
        <Input value={newAgentName} onChange={e => setNewAgentName(e.target.value)} placeholder="Agent naam..." className="flex-grow"/>
        <Button onClick={addAgent} className="bg-green-500 hover:bg-green-600">Voeg agent toe</Button>
        <Button onClick={() => setShowFlowchart(!showFlowchart)} variant="outline" className="ml-2">{showFlowchart ? 'Verberg flowchart' : 'Toon flowchart'}</Button>
        <Button onClick={openResetConfirmation} className="ml-2 bg-red-500 hover:bg-red-600">Reset alles</Button>
      </div>

      {manualApproval && pendingMessages.length > 0 && (
        <Card className="p-4 bg-yellow-50 border-yellow-300 border">
          <h3 className="font-bold text-lg mb-2">Berichten wachtend op goedkeuring</h3>
          <div className="space-y-3 max-h-60 overflow-y-auto">
            {pendingMessages.map(msg => (
              <div key={msg.id} className="bg-white p-3 rounded-lg shadow-sm border border-yellow-200">
                <div className="flex justify-between items-start mb-2">
                  <div><span className="font-medium">{msg.fromAgentName}</span><span className="text-gray-500 mx-2">→</span><span className="font-medium">{msg.toAgentName}</span></div>
                  <div className="text-xs text-gray-500">{new Date(msg.timestamp).toLocaleTimeString()}</div>
                </div>
                <div className="bg-gray-50 p-2 rounded text-sm mb-3 max-h-28 overflow-y-auto">{msg.message}</div>
                <div className="flex justify-end gap-2">
                  <Button onClick={() => rejectMessage(msg.id)} variant="outline" size="sm" className="text-red-600 border-red-300 hover:bg-red-50">Annuleren</Button>
                  <Button onClick={() => approveMessage(msg.id)} size="sm" className="bg-green-600 hover:bg-green-700 text-white">Goedkeuren & Doorsturen</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {showApiKeyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
            <h3 className="text-lg font-bold mb-4">API Instellingen</h3>
            <p className="mb-4 text-sm text-gray-600">Selecteer een provider en voer de API sleutel in.</p>
            {apiKeySaveSuccess && (
              <div className="mb-4 p-2 bg-green-50 border border-green-200 rounded text-green-700 text-sm">API sleutel succesvol opgeslagen!</div>
            )}
            <form onSubmit={handleApiKeySubmit}>
              <div className="mb-4">
                <label htmlFor="api-provider" className="block text-sm font-medium mb-1">API Provider</label>
                <select id="api-provider" value={selectedProviderForModal} onChange={handleProviderChangeInModal} className="w-full border rounded px-3 py-2 text-sm shadow-sm">
                  {Object.entries(queueStatus.availableProviders || {}).map(([id, provider]) => (
                    <option key={id} value={id}>{provider.name}</option>
                  ))}
                </select>
              </div>
              {selectedProviderForModal === 'openai' && (
                <>
                  <div className="mb-4">
                    <label htmlFor="openai-api-key" className="block text-sm font-medium mb-1">OpenAI API Sleutel</label>
                    <Input id="openai-api-key" type="password" value={openaiApiKeyInput} onChange={e => setOpenaiApiKeyInput(e.target.value)} placeholder="sk-..." className="w-full" autoComplete="off"/>
                  </div>
                  <div className="mb-4">
                    <label htmlFor="org-id" className="block text-sm font-medium mb-1">OpenAI Organization ID (optioneel)</label>
                    <Input id="org-id" type="text" value={orgIdInput} onChange={e => setOrgIdInput(e.target.value)} placeholder="org-..." className="w-full" autoComplete="off"/>
                  </div>
                </>
              )}
              {selectedProviderForModal === 'anthropic' && (
                <div className="mb-4">
                  <label htmlFor="claude-api-key" className="block text-sm font-medium mb-1">Anthropic (Claude) API Sleutel</label>
                  <Input id="claude-api-key" type="password" value={claudeApiKeyInput} onChange={e => setClaudeApiKeyInput(e.target.value)} placeholder="sk-ant-api03-..." className="w-full" autoComplete="off"/>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowApiKeyModal(false)}>Annuleren</Button>
                <Button type="submit" className="bg-blue-500 hover:bg-blue-600">Opslaan</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showResetConfirmation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
            <h3 className="text-lg font-bold mb-4">Bevestig reset</h3>
            <p className="mb-6">Weet je zeker dat je alle agents wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt.</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowResetConfirmation(false)}>Annuleren</Button>
              <Button className="bg-red-500 hover:bg-red-600" onClick={resetAgents}>Ja, reset alles</Button>
            </div>
          </div>
        </div>
      )}

      {showFlowchart && agents.length > 0 && (
        <Card className="p-2 overflow-hidden">
          <h2 className="text-lg font-semibold mb-2 px-2">Agent Flowchart</h2>
          <div className="h-[400px] w-full">
            <AgentFlowchart
              nodes={flowchartNodes}
              edges={flowchartEdges}
            />
          </div>
        </Card>
      )}

      <Card className="bg-gray-100 p-4 rounded-xl">
        <h2 className="text-xl font-bold mb-2">🧠 Praat tegen de hoofdagent ({mainAgentName})</h2>
        <div className="flex gap-2 mb-2">
          <Input
            value={mainInput}
            onChange={e => setMainInput(e.target.value)}
            placeholder="Typ je vraag of opdracht..."
            className="flex-grow"
          />
          <Button
            onClick={sendToMainAgent}
            disabled={loadingAgentId !== null || agents.length === 0 || (queueStatus.rateLimitHit && !queueStatus.offlineMode) || queueStatus.isPaused}
            className="bg-blue-500 hover:bg-blue-600"
          >
            {loadingAgentId ? 'Versturen...' : 'Stuur'}
          </Button>
        </div>
        <div className="bg-white rounded p-3 max-h-40 overflow-y-auto text-sm shadow-inner">
          {agents.find(a => a.isMainAgent)?.messages?.map((msg, i) => (
            <div key={i} className="mb-1 pb-1 border-b border-gray-100 last:border-0">
              <strong>{msg.from}:</strong> {msg.text}
            </div>
          )) || <div className="text-gray-500">Nog geen berichten. Voeg eerst een agent toe en markeer deze als hoofdagent.</div>}
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((agent, index) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            agents={agents}
            loading={loadingAgentId === agent.id}
            onTaskChange={updateTask}
            onForwardChange={updateForwarding}
            onRemove={removeAgent}
            onSetAsMain={() => setAsMainAgent(agent.id)}
            onMoveUp={() => moveAgentUp(agent.id)}
            onMoveDown={() => moveAgentDown(agent.id)}
            isFirst={index === 0}
            isLast={index === agents.length - 1}
          />
        ))}
      </div>

      <Card className="mt-6 p-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Gegenereerde Code</h2>
          <div className="flex gap-2">
            <Button
              onClick={handleDownloadCode}
              disabled={generatedCodeBlocks.length === 0}
              className="bg-blue-500 hover:bg-blue-600 text-white"
            >
              Download Project (.zip)
            </Button>
            <Button
              onClick={() => setShowClearCodeConfirmation(true)}
              disabled={generatedCodeBlocks.length === 0}
              variant="outline"
              className="text-red-500 hover:bg-red-50"
            >
              Wis Alle Code
            </Button>
          </div>
        </div>

        {generatedCodeBlocks.length === 0 ? (
          <p className="text-gray-500">Nog geen code gegenereerd. Stuur opdrachten naar de agents om code te laten maken.</p>
        ) : (
          <div className="space-y-4 max-h-[600px] overflow-y-auto">
            {generatedCodeBlocks.map((block) => (
              <div key={block.id} className="border rounded-lg p-3 bg-gray-50">
                <div className="flex justify-between items-center mb-2">
                  <div>
                    <span className="font-semibold">{block.filename}</span>
                    <span className="text-xs text-gray-500 ml-2">(Gegenereerd door: {block.agentName}, Taal: {block.language})</span>
                  </div>
                  <Button
                    onClick={() => copyToClipboard(block.code)}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                  >
                    Kopieer Code
                  </Button>
                </div>
                <pre className="bg-gray-800 text-white p-3 rounded-md text-sm overflow-x-auto">
                  <code>{block.code}</code>
                </pre>
              </div>
            ))}
          </div>
        )}
      </Card>

      {showClearCodeConfirmation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
            <h3 className="text-lg font-bold mb-4">Bevestig Wissen Code</h3>
            <p className="mb-6">Weet je zeker dat je alle gegenereerde code wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt.</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowClearCodeConfirmation(false)}>Annuleren</Button>
              <Button className="bg-red-500 hover:bg-red-600" onClick={handleClearGeneratedCode}>Ja, wis alle code</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
