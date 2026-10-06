import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CollaborationSettings } from './CollaborationSettings';

afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('creates a scoped credential, hides it on dismissal, and keeps approval opt-in',async()=>{
  const writes: {body:unknown;headers:unknown}[]=[];
  vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
    const url=String(input);
    if(init?.method==='POST') {writes.push({body:JSON.parse(String(init.body)),headers:init.headers});return new Response(JSON.stringify({token:'fixture-token'}));}
    if(url.endsWith('/connections'))return new Response(JSON.stringify({connections:[{id:'connection',label:'Personal model',scope:'personal',enabled:true}]}));
    if(url.endsWith('/defaults'))return new Response(JSON.stringify({selection:{connection:'connection',model:'fixture-model'}}));
    return new Response(JSON.stringify({credentials:[]}));
  });
  render(<CollaborationSettings csrfToken="fixture-csrf"/>);
  fireEvent.click(screen.getByText('External agent collaboration'));
  await waitFor(()=>expect(screen.getByLabelText('Model')).toHaveValue('fixture-model'));
  expect(screen.getByLabelText('Resolve operation approvals')).not.toBeChecked();
  fireEvent.change(screen.getByLabelText('Agent name'),{target:{value:'External helper'}});
  fireEvent.click(screen.getByText('Create credential'));
  await waitFor(()=>expect(screen.getByLabelText('New collaboration credential')).toHaveValue('fixture-token'));
  expect(writes[0]?.body).toMatchObject({name:'External helper',connection:'connection',model:'fixture-model',scopes:['read','run','cancel']});
  fireEvent.click(screen.getByText('Dismiss credential'));
  expect(screen.queryByLabelText('New collaboration credential')).toBeNull();
  fireEvent.click(screen.getByLabelText('Allow all'));
  expect(screen.getByLabelText('Resolve operation approvals')).toBeChecked();
});
