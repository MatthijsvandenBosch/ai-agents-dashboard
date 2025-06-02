import React from 'react';
import { Card } from "./components/ui/card";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import { Select, SelectItem } from "./components/ui/select";

export default function AgentCard({ 
  agent, 
  agents, 
  loading, 
  onTaskChange, 
  onForwardChange, 
  onRemove,
  onSetAsMain,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast 
}) {
  if (!agent) return null;

  // Filter out the current agent from the forwarding options to prevent loops
  const forwardOptions = agents.filter(a => a.id !== agent.id);
  
  const cardClasses = `p-4 bg-white shadow-md rounded-lg ${agent.isMainAgent ? 'border-2 border-green-500 ring-2 ring-green-200' : 'border border-gray-200'}`;

  return (
    <Card className={cardClasses}>
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-lg font-semibold">
          {agent.name} 
          {agent.isMainAgent && <span className="text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded-full ml-2">Hoofdagent</span>}
          {loading && <span className="text-blue-500 animate-pulse ml-2">⏳</span>}
        </h3>
        <Button 
          variant="outline" 
          size="sm" 
          className="text-red-500 hover:bg-red-50 text-xs px-2 py-1" 
          onClick={() => onRemove(agent.id)}
        >
          Verwijder
        </Button>
      </div>

      <div className="flex gap-1 mb-3">
        {!agent.isMainAgent && (
          <Button 
            variant="outline" 
            size="sm" 
            className="text-xs px-2 py-1 flex-grow"
            onClick={() => onSetAsMain(agent.id)}
          >
            Markeer als Hoofd
          </Button>
        )}
        <Button 
          variant="outline" 
          size="sm" 
          className="text-xs px-2 py-1"
          onClick={() => onMoveUp(agent.id)}
          disabled={isFirst}
        >
          ↑ Omhoog
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          className="text-xs px-2 py-1"
          onClick={() => onMoveDown(agent.id)}
          disabled={isLast}
        >
          ↓ Omlaag
        </Button>
      </div>
      
      <div className="mb-3">
        <label className="block text-sm font-medium mb-1">Taak</label>
        <Textarea 
          value={agent.task || ''} 
          onChange={e => onTaskChange(agent.id, e.target.value)}
          placeholder="Beschrijf de taak van deze agent..."
          className="w-full min-h-[80px]"
        />
      </div>
      
      <div className="mb-3">
        <label className="block text-sm font-medium mb-1">Stuur output door naar</label>
        <Select 
          value={agent.forwardTo || ''} 
          onValueChange={value => onForwardChange(agent.id, value || null)}
        >
          <SelectItem value="">Niemand</SelectItem>
          {forwardOptions.map(a => (
            <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
          ))}
        </Select>
      </div>
      
      <div>
        <label className="block text-sm font-medium mb-1">Berichten</label>
        <div className="bg-gray-50 rounded p-2 max-h-[150px] overflow-y-auto text-sm">
          {agent.messages.length > 0 ? (
            agent.messages.map((msg, i) => (
              <div key={i} className="mb-1 pb-1 border-b border-gray-100 last:border-0">
                <strong>{msg.from}:</strong> {msg.text}
              </div>
            ))
          ) : (
            <div className="text-gray-500">Geen berichten.</div>
          )}
        </div>
      </div>
    </Card>
  );
}