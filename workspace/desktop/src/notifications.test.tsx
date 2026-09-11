import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {AutomationSubscription,NotificationMessages,NotificationSettings} from './notifications';
beforeAll(()=>{HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};});
afterEach(()=>vi.unstubAllGlobals());
const preferences={neura:true,email:false,sms:false,emailAvailable:true,account_email:'member@example.org',defaults:['neura']};
describe('notification controls',()=>{
 it('loads defaults and saves only the signed-in users subscription with CSRF',async()=>{
  const calls:unknown[]=[];vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
   if(url==='/api/session')return Response.json({csrfToken:'test-csrf'});
   if(init?.method==='PUT'){expect(init.headers['X-CSRF-Token']).toBe('test-csrf');calls.push(JSON.parse(init.body));}
   return Response.json({preferences,subscription:null});
  }));
  render(<AutomationSubscription jobId="job-id"/>);fireEvent.click(screen.getByRole('button',{name:'Subscribe'}));
  expect(await screen.findByRole('dialog',{name:'My notifications'})).toBeVisible();expect(await screen.findByLabelText('SMS')).toBeDisabled();expect(screen.getByLabelText('Email')).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Save subscription'}));
  await waitFor(()=>expect(calls).toEqual([{events:['success','failure'],channels:['neura']}]));
 });
 it('renders offline-persisted results as text and verified links',()=>{
  render(<NotificationMessages entries={[{id:'event',title:'Example business',message:'A verified concept is ready.',outcome:'success',created_at:'2026-09-01T00:00:00Z',unread:true,links:[{label:'Open site',url:'https://example.org'}]}]}/>);
  expect(screen.getByRole('link',{name:'Open site'})).toHaveAttribute('href','https://example.org');
  expect(screen.getByText('A verified concept is ready.')).toBeVisible();
 });
 it('handles unavailable preference responses without crashing account settings',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({})));
  render(<NotificationSettings/>);expect(await screen.findByRole('alert')).toHaveTextContent('Notification preferences are unavailable');
 });
});
