import { build } from 'esbuild';
import { writeFile, mkdir } from 'node:fs/promises';
const bundle = await build({entryPoints:['src/chartLayout.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {buildLayout} = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const data = await (await fetch('http://127.0.0.1:8010/api/org-chart')).json();
await mkdir('../output/pdf',{recursive:true});
for (const mode of ['radial','compact','tree']) {
  const layout=buildLayout(data,new Set(),mode);
  const positions=layout.nodes.map(n=>({id:n.id,...n.position,depth:n.data.depth??0}));
  const response=await fetch('http://127.0.0.1:8010/api/export/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope:'full',ids:[],layout:mode,positions,paper:'chart',orientation:'portrait'})});
  if(!response.ok) throw new Error(await response.text());
  await writeFile(`../output/pdf/${mode}-organization.pdf`,Buffer.from(await response.arrayBuffer()));
  console.log(`${mode}: ${data.nodes.length} people, ${layout.edges.length} connections`);
}
