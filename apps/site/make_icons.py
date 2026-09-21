import asyncio, pathlib
from playwright.async_api import async_playwright
here = pathlib.Path(__file__).parent
svg = (here/'icon.svg').read_text()
# versão "any": cantos arredondados; "maskable"/apple: sangrado total
rounded = svg.replace('<rect width="512" height="512" fill="url(#g)"/>','<rect width="512" height="512" rx="112" fill="url(#g)"/>')
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        async def render(markup, size, out, transparent=False):
            pg = await b.new_page(viewport={'width':size,'height':size})
            sized = markup.replace("<svg ", '<svg width="%d" height="%d" ' % (size,size), 1)
            await pg.set_content('<html><body style="margin:0;background:transparent">' + sized + '</body></html>')
            await pg.screenshot(path=str(here/'dist'/'icons'/out), omit_background=True)
            await pg.close()
        await render(rounded,192,'icon-192.png'); await render(rounded,512,'icon-512.png')
        await render(svg,512,'icon-maskable-512.png'); await render(svg,180,'apple-touch-icon.png')
        await render(rounded,32,'favicon-32.png')
        await b.close()
asyncio.run(main())
