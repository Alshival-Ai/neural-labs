import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeAll,expect,it,vi} from 'vitest';
import {ItemActions} from './ItemActions';
beforeAll(()=>{HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};});
afterEach(cleanup);
it('targets right-clicked items and requires confirmation before deletion',async()=>{
 const remove=vi.fn();render(<ItemActions name="Example" actions={[{label:'Delete',danger:true,confirm:'Remove this saved item.',run:remove}]}><button>Example</button></ItemActions>);
 fireEvent.contextMenu(screen.getByRole('button',{name:'Example'}),{clientX:20,clientY:30});fireEvent.click(screen.getByRole('menuitem',{name:'Delete'}));
 expect(remove).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Cancel'})).toHaveFocus();fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Actions for Example'}));fireEvent.click(screen.getByRole('menuitem',{name:'Delete'}));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Delete'}));await waitFor(()=>expect(remove).toHaveBeenCalledOnce());
});
it('supports keyboard opening, skips disabled items, and restores focus',()=>{
 render(<ItemActions name="Example" actions={[{label:'Open',run:vi.fn()},{label:'Protected',disabled:true,run:vi.fn()},{label:'Duplicate',run:vi.fn()}]}><button>Example</button></ItemActions>);
 const row=screen.getByRole('button',{name:'Example'});row.focus();fireEvent.keyDown(row,{key:'F10',shiftKey:true});expect(screen.getByRole('menuitem',{name:'Open'})).toHaveFocus();fireEvent.keyDown(screen.getByRole('menu'),{key:'ArrowDown'});expect(screen.getByRole('menuitem',{name:'Duplicate'})).toHaveFocus();fireEvent.keyDown(document,{key:'Escape'});expect(row).toHaveFocus();
});
it('keeps a failed deletion in its dialog for retry',async()=>{
 render(<ItemActions name="Example" actions={[{label:'Delete',confirm:'Remove it.',run:async()=>{throw Error('Changed on server');}}]}/>);
 fireEvent.click(screen.getByRole('button',{name:'Actions for Example'}));fireEvent.click(screen.getByRole('menuitem',{name:'Delete'}));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Delete'}));expect(await screen.findByRole('alert')).toHaveTextContent('Changed on server');expect(screen.getByRole('dialog')).toBeInTheDocument();
});
