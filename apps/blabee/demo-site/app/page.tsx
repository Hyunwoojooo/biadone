import type { Metadata } from "next";
export const metadata: Metadata = { title: "아이디어를 한눈에", description: "복잡한 아이디어를 짧고 쉽게 확인해보세요." };
const features = [["01", "빠르게 이해하기", "핵심 내용만 모아 쉽게 이해할 수 있어요."], ["02", "한곳에서 살펴보기", "흩어진 정보를 깔끔하게 확인할 수 있어요."], ["03", "바로 시작하기", "설명만 읽고 다음 행동을 정할 수 있어요."]];
export default function Home() { return <main>
  <nav className="nav shell"><span className="brand"><span className="brand-dot" /> idea.one</span><a href="#start">시작하기 ↗</a></nav>
  <section className="hero shell"><div className="eyebrow">A SIMPLE DEMO FOR BIG IDEAS</div><h1>아이디어를<br /><em>한눈에.</em></h1><p>복잡한 아이디어를 짧고 쉽게 확인해보세요.<br />좋은 생각은 설명하기 쉬워야 하니까요.</p><a className="button" href="#features">둘러보기 ↓</a><div className="orbit orbit-one" /><div className="orbit orbit-two" /></section>
  <section id="features" className="section shell"><div className="section-head"><span>01 / 03</span><h2>무엇을<br /><em>할 수 있나요?</em></h2></div><div className="feature-grid">{features.map(([n,t,b]) => <article className="feature" key={n}><small>{n}</small><h3>{t}</h3><p>{b}</p></article>)}</div></section>
  <section className="example shell"><div className="section-head"><span>02 / 03</span><h2>이렇게<br /><em>활용해보세요.</em></h2></div><div className="example-card"><small>EXAMPLE</small><p>“새로운 서비스를<br /><strong>누구나 10초 안에</strong><br />이해하게 만들기”</p><b>↗</b></div></section>
  <section id="start" className="cta shell"><span>03 / 03</span><h2>지금<br /><em>시작해보세요.</em></h2><p>작은 아이디어도 한눈에 보이면<br />멋진 시작이 될 수 있어요.</p><a className="button light" href="#top">다시 보기 ↑</a></section>
  <footer className="footer shell"><span className="brand"><span className="brand-dot" /> idea.one</span><span>Simple things, clearly told.</span></footer>
</main>; }
