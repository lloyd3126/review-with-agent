export default function ReferenceList({lesson}) {
  const materials = lesson?.materials || [];
  return <section className="pane references-pane" aria-label="參考資料" aria-disabled={!lesson}>
    {materials.length ? <ul className="material-list" aria-label="參考資料清單">
      {materials.map(material => <li className="material-name" key={material.name}>{material.name}</li>)}
    </ul> : <p className="help">尚未加入參考資料，可請 Agent 協助加入。</p>}
  </section>;
}
