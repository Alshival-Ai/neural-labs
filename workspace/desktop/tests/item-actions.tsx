import {createRoot} from 'react-dom/client';
import {SkillsApp,PLACEHOLDER_SKILLS} from '../src/SkillsApp';
import {AutomationsApp} from '../src/AutomationsApp';
import '../src/styles.css';
const record=(action:string)=>{document.body.dataset.action=action;};
createRoot(document.getElementById('root')!).render(<div style={{container:"app-window / inline-size",height:"100%",width:"100%"}}><SkillsApp skills={PLACEHOLDER_SKILLS} onEditSkill={()=>record('edit')} onDuplicateSkill={async()=>{record('duplicate');}} onDeleteSkill={async()=>record('delete')} canDeleteSkill={()=>true} onShare={async()=>record('share')} onInvoke={()=>record('invoke')} drafts={[{id:'sample',title:'Sample draft',kind:'skill',ownerDisplayName:'Example',updatedAt:new Date().toISOString(),canManageCollaborators:true}]} onDuplicateDraft={async()=>record('duplicate-draft')} onDeleteDraft={async()=>record('delete-draft')} automationsContent={<AutomationsApp onDuplicate={async()=>{record('duplicate-automation');return 'copy';}} onDelete={async()=>record('delete-automation')} onToggle={async()=>record('toggle')} onRun={async()=>record('run')}/>}/></div>);
