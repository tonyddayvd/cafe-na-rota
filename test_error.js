const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.error('PAGE ERROR:', error.message));
  page.on('requestfailed', request =>
    console.log('REQUEST FAILED:', request.url(), request.failure().errorText)
  );

  console.log('Carregando página...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
  
  console.log('Tentando clicar em estoque...');
  await page.evaluate(() => {
     document.querySelector('[data-view="estoque"]').click();
  });
  
  console.log('Verificando aba ativa:', await page.evaluate(() => document.querySelector('.view.active').id));
  
  await browser.close();
})();
