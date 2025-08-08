import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";

// --- AI Initialization ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// --- TypeScript Interfaces ---
interface Task {
  id: string;
  name: string;
  description: string;
  status: 'Not Started' | 'In Progress' | 'Completed' | 'Blocked';
  subtasks: Task[];
}

interface Stakeholder {
  name: string;
  role: string;
  contact: string;
}

interface Blocker {
  id: string;
  description: string;
  resolved: boolean;
}

interface Resource {
    name: string;
    type: 'Tool' | 'Library' | 'Documentation' | 'Human Resource';
    url?: string;
    description: string;
}

interface Project {
  projectName: string;
  projectType: string;
  projectGoals: string[];
  tasks: Task[];
  progress: number;
  priorities: { 
    speed: number;
    scope: number;
  };
  stakeholders: Stakeholder[];
  timeline: {
    startDate: string;
    targetDate: string;
  };
  blockers: Blocker[];
  resources: Resource[];
  suggestedActions: string[];
}

interface ChatMessage {
    sender: 'user' | 'ai';
    text: string;
    timestamp: string;
}

// --- AI Schemas ---
const projectCreationSchema = {
  type: Type.OBJECT,
  properties: {
    project: {
      type: Type.OBJECT,
      properties: {
        projectName: { type: Type.STRING },
        projectType: { type: Type.STRING },
        projectGoals: { type: Type.ARRAY, items: { type: Type.STRING } },
        initialTasks: {
          type: Type.ARRAY,
          description: "An initial list of 3-5 high-level tasks to start the project.",
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              description: { type: Type.STRING }
            },
            required: ['name', 'description']
          }
        }
      },
      required: ['projectName', 'projectType', 'projectGoals', 'initialTasks']
    },
    openingStatement: { 
        type: Type.STRING, 
        description: "A welcoming message for the user that confirms the project has been created and suggests a first step."
    },
    suggestedActions: { 
        type: Type.ARRAY, 
        items: { type: Type.STRING }, 
        description: "An array of 2-3 initial actions or questions that the user can take."
    }
  },
  required: ['project', 'openingStatement', 'suggestedActions']
};

const nextStepSchema = {
    type: Type.OBJECT,
    properties: {
        consultancyUpdate: {
            type: Type.OBJECT,
            properties: {
                responseText: { type: Type.STRING, description: "The AI consultant's response to the user's message."},
                suggestedActions: { type: Type.ARRAY, items: { type: Type.STRING }, description: "A new array of 2-3 suggested actions or questions for the user."},
                progressUpdate: { type: Type.INTEGER, description: "The number of percentage points the overall project progress has changed. This can be a positive or negative integer."},
                priorityUpdate: {
                    type: Type.OBJECT,
                    description: "How the user's message affects the project's priorities. Omit if no change.",
                    properties: {
                        speed: { type: Type.INTEGER, description: "The change in speed vs. quality priority." },
                        scope: { type: Type.INTEGER, description: "The change in MVP vs. feature-rich priority." }
                    }
                },
                blockers: {
                    type: Type.ARRAY,
                    description: "An array of new blockers identified. Otherwise, this should be empty or null.",
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            description: { type: Type.STRING }
                        },
                        required: ['description']
                    }
                },
                taskUpdates: {
                    type: Type.ARRAY,
                    description: "An array of updates to tasks: 'add', 'remove', 'update', or 'complete'.",
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            taskId: { type: Type.STRING, description: "ID of the task to update. For new tasks, use the task name as a temporary ID."},
                            name: { type: Type.STRING },
                            description: { type: Type.STRING },
                            status: { type: Type.STRING, enum: ['Not Started', 'In Progress', 'Completed', 'Blocked'] },
                            action: { type: Type.STRING, enum: ['add', 'remove', 'update', 'complete'] }
                        },
                        required: ['name', 'action']
                    }
                },
            },
            required: ['responseText', 'suggestedActions', 'progressUpdate']
        }
    },
    required: ['consultancyUpdate']
};


// --- Helper Functions ---
const generateId = () => `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// --- STYLES ---
const styles = {
    global: `
        :root {
            --bg-color: #121212;
            --surface-color: #1e1e1e;
            --primary-color: #6200ea;
            --primary-variant-color: #3700b3;
            --secondary-color: #03dac6;
            --text-color: #e0e0e0;
            --text-secondary-color: #a0a0a0;
            --error-color: #cf6679;
            --border-color: #2a2a2a;
        }
        body {
            margin: 0;
            font-family: 'Inter', sans-serif;
            background-color: var(--bg-color);
            color: var(--text-color);
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }
        * {
            box-sizing: border-box;
        }
        #root {
            width: 100vw;
            height: 100vh;
            overflow: hidden;
        }
    `,
    app: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
    },
    creationScreen: {
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        padding: '40px',
        backgroundColor: 'var(--surface-color)',
        borderRadius: '12px',
        width: 'clamp(300px, 90%, 500px)',
        boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
    },
    input: {
        width: '100%',
        padding: '12px',
        backgroundColor: 'var(--bg-color)',
        border: '1px solid var(--border-color)',
        borderRadius: '8px',
        color: 'var(--text-color)',
        fontSize: '16px',
    },
    button: {
        padding: '12px 20px',
        backgroundColor: 'var(--primary-color)',
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        fontSize: '16px',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'background-color 0.2s',
    },
    consultancyScreen: {
        display: 'grid',
        gridTemplateColumns: '400px 1fr',
        width: '100%',
        height: '100%',
    },
    projectPane: {
        backgroundColor: 'var(--surface-color)',
        padding: '20px',
        overflowY: 'auto',
        borderRight: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
    },
    chatPane: {
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
    },
    consultancyLog: {
        flexGrow: 1,
        padding: '20px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '15px',
    },
    chatMessage: {
        padding: '10px 15px',
        borderRadius: '10px',
        maxWidth: '70%',
        lineHeight: 1.5,
    },
    actionPanel: {
        padding: '20px',
        borderTop: '1px solid var(--border-color)',
        backgroundColor: '#161616',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
    },
    inputGroup: {
        display: 'flex',
        gap: '10px',
    },
    suggestedActions: {
        display: 'flex',
        gap: '10px',
        flexWrap: 'wrap',
    },
    suggestedButton: {
      padding: '8px 12px',
      backgroundColor: 'var(--surface-color)',
      color: 'var(--secondary-color)',
      border: '1px solid var(--secondary-color)',
      borderRadius: '20px',
      fontSize: '14px',
      cursor: 'pointer',
      transition: 'background-color 0.2s',
    }
};

// --- Components ---

interface TaskItemProps {
    task: Task;
    onStatusChange: (taskId: string, status: Task['status']) => void;
}

const TaskItem: React.FC<TaskItemProps> = ({ task, onStatusChange }) => {
    const statusColors = {
        'Not Started': '#a0a0a0',
        'In Progress': '#3b82f6',
        'Completed': '#10b981',
        'Blocked': '#ef4444',
    };

    return (
        <div style={{ padding: '10px', border: '1px solid var(--border-color)', borderRadius: '8px', backgroundColor: '#242424' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p style={{ margin: 0, fontWeight: 600 }}>{task.name}</p>
                <span style={{
                    padding: '4px 8px',
                    borderRadius: '12px',
                    fontSize: '12px',
                    color: 'white',
                    backgroundColor: statusColors[task.status]
                }}>{task.status}</span>
            </div>
            <p style={{ margin: '5px 0 0', fontSize: '14px', color: 'var(--text-secondary-color)' }}>{task.description}</p>
             {task.status !== 'Completed' && (
                <button 
                    onClick={() => onStatusChange(task.id, 'Completed')}
                    style={{ marginTop: '10px', padding: '5px 10px', fontSize: '12px', cursor: 'pointer', backgroundColor: '#333', border: '1px solid var(--border-color)', color: 'var(--text-color)', borderRadius: '5px'}}
                >
                    Mark as Completed
                </button>
            )}
        </div>
    );
};

const ProjectPane = ({ project, onTaskStatusChange, onReset }: { project: Project; onTaskStatusChange: (taskId: string, status: Task['status']) => void; onReset: () => void; }) => (
    <div style={styles.projectPane as React.CSSProperties}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
          <h1 style={{ margin: 0, color: 'var(--secondary-color)' }}>{project.projectName}</h1>
          <button onClick={onReset} style={{...styles.button, backgroundColor: 'var(--error-color)', fontSize: '12px', padding: '8px 12px'}}>Reset</button>
        </div>
        <p style={{ marginTop: 0, color: 'var(--text-secondary-color)' }}>{project.projectType}</p>
        
        <div>
            <label>Progress: {project.progress}%</label>
            <div style={{ width: '100%', backgroundColor: '#333', borderRadius: '5px', overflow: 'hidden', height: '10px', marginTop: '5px' }}>
                <div style={{ width: `${project.progress}%`, height: '100%', backgroundColor: 'var(--primary-color)', transition: 'width 0.5s' }} />
            </div>
        </div>

        <div>
            <h3>Tasks</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {project.tasks.map(task => <TaskItem key={task.id} task={task} onStatusChange={onTaskStatusChange} />)}
            </div>
        </div>

        {project.blockers.filter(b => !b.resolved).length > 0 && (
            <div>
                <h3>Blockers</h3>
                <ul style={{ paddingLeft: '20px', margin: 0, display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    {project.blockers.filter(b => !b.resolved).map(blocker => <li key={blocker.id}>{blocker.description}</li>)}
                </ul>
            </div>
        )}
    </div>
);

const ConsultancyLog = ({ chatHistory }: { chatHistory: ChatMessage[] }) => {
    const logEndRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatHistory]);

    return (
        <div style={styles.consultancyLog as React.CSSProperties}>
            {chatHistory.map((msg, index) => (
                <div key={index} style={{
                    ...styles.chatMessage as React.CSSProperties,
                    alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                    backgroundColor: msg.sender === 'user' ? 'var(--primary-color)' : 'var(--surface-color)',
                }}>
                    {msg.text}
                </div>
            ))}
            <div ref={logEndRef} />
        </div>
    );
};

const ActionPanel = ({ onSendMessage, isLoading, suggestedActions }: { onSendMessage: (message: string) => void; isLoading: boolean; suggestedActions: string[] }) => {
    const [message, setMessage] = useState('');

    const handleSend = () => {
        if (message.trim() && !isLoading) {
            onSendMessage(message.trim());
            setMessage('');
        }
    };

    const handleSuggestedSend = (action: string) => {
        if (!isLoading) {
            onSendMessage(action);
        }
    };

    return (
        <div style={styles.actionPanel as React.CSSProperties}>
             {suggestedActions && suggestedActions.length > 0 && (
                <div style={styles.suggestedActions as React.CSSProperties}>
                    {suggestedActions.map((action, i) => (
                        <button key={i} style={styles.suggestedButton as React.CSSProperties} onClick={() => handleSuggestedSend(action)} disabled={isLoading}>
                            {action}
                        </button>
                    ))}
                </div>
            )}
            <div style={styles.inputGroup as React.CSSProperties}>
                <input
                    type="text"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                    placeholder="Tell me about your progress..."
                    style={styles.input as React.CSSProperties}
                    disabled={isLoading}
                />
                <button onClick={handleSend} disabled={isLoading} style={styles.button as React.CSSProperties}>
                    {isLoading ? 'Thinking...' : 'Send'}
                </button>
            </div>
        </div>
    );
};

const ChatPane = ({ chatHistory, onSendMessage, isLoading, suggestedActions }: { chatHistory: ChatMessage[]; onSendMessage: (message: string) => void; isLoading: boolean; suggestedActions: string[] }) => (
    <div style={styles.chatPane as React.CSSProperties}>
        <ConsultancyLog chatHistory={chatHistory} />
        <ActionPanel onSendMessage={onSendMessage} isLoading={isLoading} suggestedActions={suggestedActions} />
    </div>
);

const ConsultancyScreen = ({ project, chatHistory, onSendMessage, onTaskStatusChange, isLoading, onReset }: { project: Project; chatHistory: ChatMessage[]; onSendMessage: (message: string) => void; onTaskStatusChange: (taskId: string, status: Task['status']) => void; isLoading: boolean; onReset: () => void }) => (
    <div style={styles.consultancyScreen as React.CSSProperties}>
        <ProjectPane project={project} onTaskStatusChange={onTaskStatusChange} onReset={onReset} />
        <ChatPane chatHistory={chatHistory} onSendMessage={onSendMessage} isLoading={isLoading} suggestedActions={project.suggestedActions} />
    </div>
);

const ProjectCreationScreen = ({ onCreateProject, isLoading }: { onCreateProject: (name: string, type: string, goals: string) => void; isLoading: boolean; }) => {
    const [projectName, setProjectName] = useState('');
    const [projectType, setProjectType] = useState('');
    const [projectGoals, setProjectGoals] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (projectName && projectType && projectGoals) {
            onCreateProject(projectName, projectType, projectGoals);
        }
    };

    return (
        <form onSubmit={handleSubmit} style={styles.creationScreen as React.CSSProperties}>
            <h1 style={{textAlign: 'center', margin: 0}}>Create Your Project</h1>
            <p style={{textAlign: 'center', margin: 0, color: 'var(--text-secondary-color)'}}>Let's get your new project set up with the AI assistant.</p>
            <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Project Name (e.g., 'My Awesome App')"
                style={styles.input as React.CSSProperties}
                required
            />
            <input
                type="text"
                value={projectType}
                onChange={(e) => setProjectType(e.target.value)}
                placeholder="Project Type (e.g., 'Web App')"
                style={styles.input as React.CSSProperties}
                required
            />
            <textarea
                value={projectGoals}
                onChange={(e) => setProjectGoals(e.target.value)}
                placeholder="Main Goals (comma-separated, e.g., 'User auth, dashboard, payments')"
                style={{ ...styles.input as React.CSSProperties, height: '100px', resize: 'vertical' }}
                required
            />
            <button type="submit" disabled={isLoading} style={styles.button as React.CSSProperties}>
                {isLoading ? 'Generating Project...' : 'Create Project'}
            </button>
        </form>
    );
};

const App = () => {
    const [project, setProject] = useState<Project | null>(null);
    const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        try {
            const savedProject = localStorage.getItem('project');
            const savedChatHistory = localStorage.getItem('chatHistory');
            if (savedProject) {
                setProject(JSON.parse(savedProject));
            }
            if (savedChatHistory) {
                setChatHistory(JSON.parse(savedChatHistory));
            }
        } catch (error) {
            console.error("Failed to load from local storage", error);
            localStorage.clear();
        }
    }, []);

    useEffect(() => {
        if (project) {
            localStorage.setItem('project', JSON.stringify(project));
        } else {
            localStorage.removeItem('project');
        }
    }, [project]);
    
    useEffect(() => {
        if (chatHistory.length > 0) {
            localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
        } else {
            localStorage.removeItem('chatHistory');
        }
    }, [chatHistory]);

    const handleCreateProject = async (name: string, type: string, goals: string) => {
        setIsLoading(true);
        try {
            const prompt = `Create a new project. Name: "${name}", Type: "${type}", Goals: "${goals}". Generate initial tasks, a welcoming statement, and suggested actions.`;
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: { responseMimeType: "application/json", responseSchema: projectCreationSchema },
            });

            const result = JSON.parse(response.text);
            const newProjectData = result.project;
            const newProject: Project = {
                projectName: newProjectData.projectName,
                projectType: newProjectData.projectType,
                projectGoals: newProjectData.projectGoals,
                tasks: newProjectData.initialTasks.map((task: any) => ({ ...task, id: generateId(), status: 'Not Started', subtasks: [] })),
                progress: 0,
                priorities: { speed: 0, scope: 0 },
                stakeholders: [],
                timeline: { startDate: new Date().toISOString(), targetDate: '' },
                blockers: [],
                resources: [],
                suggestedActions: result.suggestedActions,
            };
            
            const openingMessage: ChatMessage = {
                sender: 'ai',
                text: result.openingStatement,
                timestamp: new Date().toISOString(),
            };

            setProject(newProject);
            setChatHistory([openingMessage]);
        } catch (error) {
            console.error("Error creating project:", error);
            alert("Failed to create project. Please check the console for details.");
        }
        setIsLoading(false);
    };

    const handleSendMessage = async (message: string) => {
        if (!project) return;
        
        const userMessage: ChatMessage = {
            sender: 'user',
            text: message,
            timestamp: new Date().toISOString()
        };
        const updatedChatHistory = [...chatHistory, userMessage];
        setChatHistory(updatedChatHistory);
        setIsLoading(true);

        try {
            const prompt = `User message: "${message}". Current project state: ${JSON.stringify(project)}. Recent conversation: ${JSON.stringify(chatHistory.slice(-4))}. Analyze the user's message and provide a consultancy update according to the schema.`;
            
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: { responseMimeType: "application/json", responseSchema: nextStepSchema },
            });
            const result = JSON.parse(response.text);
            const update = result.consultancyUpdate;

            setProject(prevProject => {
                if (!prevProject) return null;
                
                let newTasks = [...prevProject.tasks];
                if (update.taskUpdates) {
                    update.taskUpdates.forEach((taskUpdate: any) => {
                        const existingTaskIndex = newTasks.findIndex(t => t.id === taskUpdate.taskId || t.name === taskUpdate.name);
                        
                        if (taskUpdate.action === 'add') {
                            if (existingTaskIndex === -1) {
                                newTasks.push({
                                    id: generateId(),
                                    name: taskUpdate.name,
                                    description: taskUpdate.description || '',
                                    status: taskUpdate.status || 'Not Started',
                                    subtasks: []
                                });
                            }
                        } else if (existingTaskIndex !== -1) {
                            if (taskUpdate.action === 'remove') {
                                newTasks.splice(existingTaskIndex, 1);
                            } else { // update or complete
                                newTasks[existingTaskIndex] = {
                                    ...newTasks[existingTaskIndex],
                                    name: taskUpdate.name || newTasks[existingTaskIndex].name,
                                    description: taskUpdate.description || newTasks[existingTaskIndex].description,
                                    status: taskUpdate.status || newTasks[existingTaskIndex].status,
                                };
                            }
                        }
                    });
                }

                const newProgress = Math.max(0, Math.min(100, prevProject.progress + (update.progressUpdate || 0)));
                
                let newBlockers = [...prevProject.blockers];
                if(update.blockers) {
                    update.blockers.forEach((b: any) => {
                        newBlockers.push({
                            id: generateId(),
                            description: b.description,
                            resolved: false
                        });
                    });
                }

                return {
                    ...prevProject,
                    tasks: newTasks,
                    progress: newProgress,
                    blockers: newBlockers,
                    suggestedActions: update.suggestedActions,
                    priorities: update.priorityUpdate ? {
                      speed: prevProject.priorities.speed + (update.priorityUpdate.speed || 0),
                      scope: prevProject.priorities.scope + (update.priorityUpdate.scope || 0),
                    } : prevProject.priorities,
                };
            });

            const aiMessage: ChatMessage = {
                sender: 'ai',
                text: update.responseText,
                timestamp: new Date().toISOString(),
            };
            setChatHistory(prev => [...prev, aiMessage]);

        } catch (error) {
            console.error("Error sending message:", error);
            const errMessage: ChatMessage = {
                sender: 'ai',
                text: "Sorry, I encountered an error. Please try again.",
                timestamp: new Date().toISOString()
            };
            setChatHistory(prev => [...prev, errMessage]);
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleTaskStatusChange = (taskId: string, status: Task['status']) => {
        const task = project?.tasks.find(t => t.id === taskId);
        if(task && status === 'Completed') {
            handleSendMessage(`I have just completed the task: "${task.name}".`);
        }
    };

    const handleReset = () => {
        if(window.confirm("Are you sure you want to reset the project? All data will be lost.")) {
            localStorage.clear();
            setProject(null);
            setChatHistory([]);
        }
    }

    return (
        <>
            <style>{styles.global}</style>
            <div style={styles.app as React.CSSProperties}>
                {project ? (
                    <ConsultancyScreen
                        project={project}
                        chatHistory={chatHistory}
                        onSendMessage={handleSendMessage}
                        onTaskStatusChange={handleTaskStatusChange}
                        isLoading={isLoading}
                        onReset={handleReset}
                    />
                ) : (
                    <ProjectCreationScreen onCreateProject={handleCreateProject} isLoading={isLoading} />
                )}
            </div>
        </>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);