import { useCallback } from 'react';
import ReactFlow, { Background, Controls, MiniMap, useNodesState, useEdgesState, addEdge } from 'reactflow';
import 'reactflow/dist/style.css';

const initialNodes = [
  { id: '1', position: { x: 50, y: 50 }, data: { label: 'Hoofdagent' }, type: 'default' },
];

const initialEdges = [];

export default function AgentFlowchart({ nodes: propNodes, edges: propEdges }) {
  // Use provided nodes/edges or fall back to initial values
  const [nodes, setNodes, onNodesChange] = useNodesState(propNodes || initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(propEdges || initialEdges);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges]
  );

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
      >
        <MiniMap />
        <Controls />
        <Background />
      </ReactFlow>
    </div>
  );
}
