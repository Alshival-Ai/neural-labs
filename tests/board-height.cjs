// Standalone layout regression: actual board styles, synthetic cards, no server or data access.
// NODE_PATH=/home/data-team/website/src/node_modules node tests/board-height.cjs
const engines = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const styles = ['shared-project.css', 'scrapbook.css', 'flexible-board.css']
  .map(name => fs.readFileSync(path.join(__dirname, '../workspace/desktop/src/project-board/portal', name), 'utf8'))
  .join('\n');
const responsiveBoard = path.join(__dirname, '../workspace/desktop/src/project-board/portal/responsive-board.js');

(async () => {
  const browser = await engines[process.env.PLAYWRIGHT_BROWSER || 'chromium'].launch({
    headless: true, executablePath: process.env.BOARD_BROWSER_EXECUTABLE
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await page.setContent(`<style>
      * { box-sizing: border-box; } body { margin: 20px; font: 14px sans-serif;
        --paper: #fff; --ink: #222; --line: #ddd; --app-paper: #fff; --app-ink: #222; }
      .shared-project, [data-shared-project-content] { width: 100%; min-width: 0; }
      ${styles}
      </style><body class="desktop-board"><main id="workspace-board" class="shared-project" data-shared-project>
      <div data-shared-project-content><div class="sp-columns">${[
        ['To do', 'gray'],
        ['In progress', 'blue'],
        ['Waiting', 'orange'],
        ['In review', 'purple'],
        ['Done', 'green'],
        ['QA', 'pink'],
        ['Product testing', 'teal'],
        ['Ready', 'gray']
      ]
        .map(
          ([label, color]) => `<section class="sp-column" data-status-color="${color}">
        <header><h3>${label}</h3><span>0</span></header><div class="sp-stack"></div>
      </section>`
        )
        .join('')}</div></div></main></body>`);
    await page.addScriptTag({ path: responsiveBoard });
    await page.locator('main').evaluate(root => {
      root.boardTestApi = window.AlshivalResponsiveBoard(
        root,
        {
          listen: (target, type, callback, options) => target.addEventListener(type, callback, options),
          onClose: () => {}
        },
        { cancel: () => {}, report: () => {} }
      );
    });
    const appearance = await page.locator('.sp-column').evaluateAll(columns =>
      columns.slice(0, 2).map(column => ({
        width: column.getBoundingClientRect().width,
        background: getComputedStyle(column).backgroundColor
      }))
    );
    assert(Math.abs(appearance[0].width - 280) <= 1, 'Overflowing desktop columns retain their 280px minimum');
    assert.notEqual(appearance[0].background, appearance[1].background, 'Configured status colors tint each column');
    async function cards(count, column = 0) {
      await page
        .locator('.sp-stack')
        .nth(column)
        .evaluate((stack, count) => {
          stack.replaceChildren();
          if (!count) {
            stack.innerHTML = '<p class="sp-empty-small">Nothing here yet.</p>';
            return;
          }
          for (let index = 0; index < count; index++) {
            const card = document.createElement('article');
            card.className = 'sp-card';
            card.innerHTML =
              '<p class="sp-card-kind">Task</p><h4>Check the customer experience</h4>' +
              '<div class="sp-card-meta"><span>Teammate</span></div><button class="sp-move">Move to…</button>';
            stack.append(card);
          }
        }, count);
    }
    const measure = () =>
      page.locator('main').evaluate(root => {
        root.boardTestApi.refresh();
        const board = root.querySelector('.sp-columns');
        return {
          height: board.getBoundingClientRect().height,
          max: parseFloat(getComputedStyle(board).maxHeight),
          target: parseFloat(getComputedStyle(root).getPropertyValue('--board-content-height')),
          columns: [...board.children].map(column => column.getBoundingClientRect().height),
          stacks: [...board.querySelectorAll('.sp-stack')].map(stack => ({
            height: stack.clientHeight,
            scroll: stack.scrollHeight
          }))
        };
      });
    for (const viewport of [
      { width: 820, height: 1180 },
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 }
    ]) {
      await page.setViewportSize(viewport);
      for (const expanded of [false, true]) {
        await page
          .locator('main')
          .evaluate((root, value) => root.toggleAttribute('data-board-expanded', value), expanded);
        for (const comfortable of [false, true]) {
          await page
            .locator('main')
            .evaluate((root, value) => root.toggleAttribute('data-comfortable', value), comfortable);
          for (let column = 0; column < 8; column++) await cards(0, column);
          const empty = await measure();
          await cards(1);
          const single = await measure();
          await cards(2);
          const double = await measure();
          assert(
            single.height > empty.height && double.height > single.height,
            JSON.stringify({ empty, single, double })
          );
          assert(single.height < viewport.height - 100, 'One task must not reserve a full-height board');
          assert(
            single.stacks.every(stack => stack.scroll <= stack.height + 1),
            'Short columns do not scroll'
          );
          await cards(3);
          const triple = await measure();
          assert(triple.height > double.height, 'Three cards grow the collapsed board beyond two');
          assert(triple.stacks[0].scroll <= triple.stacks[0].height + 1, 'Three ordinary cards fit without scrolling');
          if (!expanded && !comfortable) await page.screenshot({ path: `/tmp/board-height-three-${viewport.width}.png` });
          for (let column = 0; column < 8; column++) await cards(0, column);
          await cards(7, 4);
          const outlier = await measure();
          if (!expanded) assert(
            Math.abs(outlier.height - triple.height) <= 2,
            'One long column is trimmed to approximately three cards: ' + JSON.stringify({ outlier, triple })
          );
          if (!expanded) assert(outlier.stacks[4].scroll > outlier.stacks[4].height, 'The outlying column scrolls independently');
          else assert(outlier.stacks[4].scroll <= outlier.stacks[4].height + 1, 'Expanded columns show all cards');
          await cards(12, 1);
          await cards(11, 2);
          const full = await measure();
          if (!expanded) assert(Math.abs(full.height - full.max) <= 1, JSON.stringify(full));
          if (!expanded) assert(
            full.stacks[1].scroll > full.stacks[1].height,
            'Tall columns scroll at the cap: ' + JSON.stringify(full)
          );
          assert(Math.max(...full.columns) - Math.min(...full.columns) < 1, 'Columns share the board height');
          for (let column = 0; column < 8; column++) await cards(0, column);
          await cards(1);
          const shrunk = await measure();
          assert(Math.abs(shrunk.height - single.height) <= 1, 'Board shrinks after cards are removed');
          console.log(
            JSON.stringify({
              viewport,
              expanded,
              comfortable,
              empty: empty.height,
              single: single.height,
              double: double.height,
              triple: triple.height,
              capped: full.height
            })
          );
        }
      }
    }
    await page.locator('main').evaluate(root => root.removeAttribute('data-board-expanded'));
    await page.setViewportSize({ width: 390, height: 844 });
    await cards(12);
    await measure();
    assert.equal(
      await page.locator('main').evaluate(root => root.style.getPropertyValue('--board-content-height')),
      '',
      'Mobile layouts do not use the desktop trimmed-height target'
    );
    console.log('PASS: column colors/width, natural growth, cap, scrolling, shrinking, densities, expanded view, and mobile.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
