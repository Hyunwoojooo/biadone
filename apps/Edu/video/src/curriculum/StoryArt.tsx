import type {StoryArtProps} from './types';
import {Arrow, Check, Cup, INK, MovingNote, Multiline, PAPER, PASTEL, Paper, Reveal, Rule, SIGNAL, Text, clamp, phase} from './StoryShapes';

type ArtProps = {time: number; accent: string};

const Foundation = ({time, accent}: ArtProps) => {
  const incoming = phase(time, .17, .4), outgoing = phase(time, .48, .76);
  return <>
    {['상품 정보', '가격·운영 조건', '고객 질문'].map((label, index) => (
      <Reveal key={label} value={phase(time, .08 + index * .06, .2 + index * .06)} dx={-24} dy={0}>
        <Paper x={50} y={112 + index * 122} width={255} height={90} fill={index === 1 ? PASTEL.peach : PAPER}>
          <Text x={76} y={168 + index * 122} size={29}>{label}</Text>
        </Paper>
        <Arrow points={[{x: 319, y: 157 + index * 122}, {x: 365, y: 157 + index * 122}, {x: 365, y: 280}, {x: 425, y: 280}]} value={incoming}/>
      </Reveal>
    ))}
    <Reveal value={phase(time, .22, .4)}>
      <path d="M442 190V151H570L608 190H804V451H442Z" fill={PASTEL.blue}/>
      <Rule x={442} y={204} width={362}/>
      <Text x={623} y={261} size={34} weight={710} align="middle">우리 사업 자료함</Text>
      {['브랜드 말투', '답변 원칙', '사용할 사업 자료'].map((label, index) => <g key={label}><path d={`M484 ${298 + index * 52}h16`} stroke={SIGNAL}/><Text x={518} y={308 + index * 52} size={26}>{label}</Text></g>)}
    </Reveal>
    <Arrow points={[{x: 822, y: 280}, {x: 898, y: 280}, {x: 898, y: 185}, {x: 967, y: 185}]} value={outgoing}/>
    <Arrow points={[{x: 898, y: 280}, {x: 898, y: 405}, {x: 967, y: 405}]} value={phase(time, .57, .79)}/>
    <Reveal value={phase(time, .45, .63)} dx={20} dy={0}><Paper x={988} y={111} width={335} height={161}><Text x={1015} y={159} size={30} weight={700}>실무 요청문</Text><Rule x={1015} y={183} width={223}/><Rule x={1015} y={215} width={261}/><Rule x={1015} y={245} width={180}/></Paper></Reveal>
    <Reveal value={phase(time, .6, .8)} dx={20} dy={0}><Paper x={988} y={330} width={335} height={158} fill={PASTEL.green}><Text x={1015} y={379} size={30} weight={700}>답변 정확도 검수</Text><Text x={1065} y={433} size={25}>실제 고객 질문 확인</Text><Check x={1018} y={411} value={phase(time, .69, .8)} size={28}/></Paper></Reveal>
    <MovingNote points={[{x: 305, y: 279}, {x: 425, y: 279}, {x: 621, y: 285}]} value={incoming} accent={accent}/>
    <MovingNote points={[{x: 804, y: 279}, {x: 898, y: 279}, {x: 898, y: 185}, {x: 988, y: 185}]} value={outgoing} accent={accent}/>
    <Text x={623} y={530} size={25} align="middle" color={SIGNAL} opacity={phase(time, .7, .8)}>상품과 가격이 바뀌면, 자료도 직접 업데이트</Text>
  </>;
};

const choices = [{code: 'A', title: '홍보 콘텐츠', color: PASTEL.blue}, {code: 'B', title: '사업 소개 웹페이지', color: '#e9e3f6'}, {code: 'C', title: '고객 문의 자동화', color: '#f8e0e3'}, {code: 'D', title: '매출 분석·보고서', color: PASTEL.peach}, {code: 'E', title: '나만의 업무 도구', color: PASTEL.green}];
const CHOICE_TRUNK_Y = 83 + 2 * 108;
const CHOICE_TRUNK_END_X = 505 + 4 * 27;
const Choice = ({time}: ArtProps) => <>
  <circle cx={233} cy={CHOICE_TRUNK_Y} r={118} fill={PASTEL.blue}/>
  <Multiline x={233} y={CHOICE_TRUNK_Y - 13} lines={['내 사업의', '필요한 일']} size={36} lineHeight={49} align="middle" weight={720}/>
  <path d={`M356 ${CHOICE_TRUNK_Y}H${CHOICE_TRUNK_END_X}`} opacity={phase(time, .1, .2)}/>
  {choices.map((choice, index) => {
    const y = 83 + index * 108, reveal = phase(time, .12 + index * .11, .27 + index * .11);
    const branchX = 505 + index * 27;
    // The middle row continues the trunk. Draw the shared horizontal line once.
    const points = y === CHOICE_TRUNK_Y
      ? [{x: CHOICE_TRUNK_END_X, y}, {x: 771, y}]
      : [{x: branchX, y: CHOICE_TRUNK_Y}, {x: branchX, y}, {x: 771, y}];
    return <g key={choice.code}>
      <Arrow points={points} value={reveal}/>
      <Reveal value={reveal} dx={18} dy={0}>
        <circle cx={826} cy={y} r={35} fill={choice.color}/>
        <Text x={826} y={y + 12} size={32} weight={720} align="middle">{choice.code}</Text>
        <Text x={890} y={y + 12} size={34} weight={570}>{choice.title}</Text>
      </Reveal>
    </g>;
  })}
  <Text x={233} y={481} align="middle" size={26} color={SIGNAL}>필요한 것부터 선택</Text>
</>;

const Content = ({time, accent}: ArtProps) => {
  const post = phase(time, .23, .48), template = phase(time, .48, .78);
  const revised = phase(time, .58, .75);
  return <>
    <Reveal value={phase(time, .06, .21)}><Cup x={118} y={233} scale={1.68} fill={PASTEL.peach}/><Text x={201} y={456} size={31} align="middle" weight={680}>상품 정보</Text><Text x={201} y={498} size={24} align="middle">사진·특징·고객</Text></Reveal>
    <Arrow points={[{x: 325, y: 300}, {x: 414, y: 300}]} value={post}/>
    <Reveal value={post}>
      <rect x={440} y={88} width={392} height={425} fill={PAPER}/>
      <path d="M440 137H832"/>
      <Text x={463} y={122} size={24} weight={670}>우리 가게 소식</Text>
      <Text x={467} y={198} size={39} weight={770}>{revised > .5 ? '따뜻한 오후,' : '오늘의 한 잔,'}</Text>
      <Text x={467} y={248} size={39} weight={770}>{revised > .5 ? '커피 한 잔.' : '조금 더 특별하게.'}</Text>
      <rect x={470} y={278} width={329} height={134} fill={PASTEL.blue} stroke="none"/>
      <Cup x={589} y={308} scale={.86}/>
      <Rule x={469} y={443} width={217}/>
      <Rule x={469} y={469} width={282}/>
      <Text x={636} y={558} size={29} weight={650} align="middle">멈춰 보게 만드는 게시물</Text>
    </Reveal>
    <Arrow points={[{x: 850, y: 300}, {x: 940, y: 300}]} value={template}/>
    <Reveal value={template} dx={20} dy={0}>
      <rect x={995} y={103} width={294} height={388} fill={PASTEL.green}/>
      <rect x={979} y={120} width={294} height={388} fill={PAPER}/>
      <rect x={962} y={137} width={294} height={388} fill={PAPER}/>
      <Text x={989} y={197} size={31} weight={730}>우리 브랜드</Text>
      <rect x={990} y={231} width={235} height={26} fill={accent} fillOpacity={.24} stroke="none"/>
      <Text x={989} y={317} size={46} weight={750}>가나다</Text>
      <Rule x={990} y={351} width={236}/>
      <rect x={990} y={383} width={236} height={67} fill={PASTEL.peach}/>
      <Text x={1108} y={426} size={25} align="middle">자막·배치</Text>
      <Text x={1108} y={558} size={29} weight={650} align="middle">다시 쓰는 제작 템플릿</Text>
    </Reveal>
    <MovingNote points={[{x: 832, y: 300}, {x: 962, y: 300}]} value={template} accent={accent}/>
  </>;
};

const Website = ({time, accent}: ArtProps) => {
  const mobile = phase(time, .31, .52), edited = phase(time, .55, .72), linked = phase(time, .65, .81);
  return <>
    <Reveal value={phase(time, .07, .23)}>
      <rect x={77} y={57} width={884} height={460} rx={3} fill={PAPER}/>
      <path d="M77 113H961"/>
      {[105, 125, 145].map(x => <circle key={x} cx={x} cy={85} r={5} fill={INK} stroke="none"/>)}
      <Text x={200} y={94} size={23}>우리 가게 / 페이지 예시</Text>
      <Reveal value={phase(time, .14, .31)}><Text x={119} y={196} size={47} weight={760}>우리 가게를 소개합니다.</Text><Rule x={122} y={233} width={475}/><Rule x={122} y={266} width={356}/><Text x={122} y={332} size={27}>드립백 세트</Text><Text x={122} y={377} size={35} weight={730} color={edited > .5 ? SIGNAL : INK}>{edited > .5 ? '18,000원' : '15,000원'}</Text><Cup x={701} y={254} scale={1.3} fill={PASTEL.green}/></Reveal>
      <Reveal value={phase(time, .25, .45)}><rect x={120} y={419} width={218} height={55} fill={accent} fillOpacity={.18}/><Text x={229} y={456} size={27} align="middle" weight={650}>문의하기 →</Text><Text x={418} y={454} size={25}>사진 · 후기 · FAQ</Text></Reveal>
    </Reveal>
    <Reveal value={mobile} dx={30} dy={0}>
      <rect x={1103} y={119} width={213} height={398} rx={20} fill={PAPER}/>
      <path d="M1173 139H1245M1103 174H1316M1103 460H1316"/>
      <Multiline x={1128} y={220} lines={['우리 가게를', '소개합니다.']} size={27} lineHeight={37} weight={730}/>
      <Rule x={1128} y={296} width={151}/><Rule x={1128} y={321} width={112}/>
      <Text x={1128} y={376} size={27} weight={720} color={edited > .5 ? SIGNAL : INK}>{edited > .5 ? '18,000원' : '15,000원'}</Text>
      <rect x={1126} y={405} width={167} height={39} fill={PASTEL.blue}/><Text x={1210} y={432} size={22} align="middle">문의</Text>
      <Check x={1190} y={475} value={phase(time, .4, .55)} size={27} color={SIGNAL}/>
    </Reveal>
    <Arrow points={[{x: 985, y: 267}, {x: 1073, y: 267}]} value={mobile}/>
    <Text x={1209} y={561} size={27} align="middle" opacity={mobile}>모바일도 직접 확인</Text>
    <Reveal value={edited}><path d="M356 345L365 326L385 347L365 354Z" fill={PASTEL.peach}/><Text x={404} y={378} size={25} color={SIGNAL}>가격 수정</Text></Reveal>
    <Reveal value={linked}><path d="M338 448H367V544H665" fill="none" stroke={SIGNAL}/><path d="M665 544l-13 -9m13 9l-13 9" stroke={SIGNAL}/><Text x={850} y={555} size={25} align="middle" color={SIGNAL}>문의 폼·전화·예약 연결</Text></Reveal>
  </>;
};

const Inquiry = ({time, accent}: ArtProps) => {
  const saving = phase(time, .22, .46), notifying = phase(time, .47, .71), review = phase(time, .64, .82);
  return <>
    <Reveal value={phase(time, .07, .23)}><path d="M49 157H326V345H153L112 381V345H49Z" fill={PASTEL.blue}/><Multiline x={79} y={219} lines={['단체 주문', '문의합니다.']} size={34} lineHeight={49} weight={690}/><Text x={184} y={440} size={29} align="middle" weight={660}>문의 접수</Text></Reveal>
    <Arrow points={[{x: 344, y: 276}, {x: 422, y: 276}]} value={saving}/>
    <Reveal value={phase(time, .2, .39)}>
      <rect x={448} y={112} width={518} height={333} fill={PAPER}/>
      <Text x={477} y={161} size={32} weight={720}>고객 관리표</Text><Rule x={448} y={184} width={518}/>
      <path d="M448 239H966M448 310H966M448 379H966M690 184V445M823 184V445"/>
      <Text x={474} y={221} size={24}>문의 유형</Text><Text x={711} y={221} size={24}>담당</Text><Text x={844} y={221} size={24}>상태</Text>
      <g opacity={saving}><rect x={450} y={241} width={514} height={67} fill={PASTEL.green} stroke="none"/><Text x={474} y={286} size={27}>단체 주문</Text><Text x={711} y={286} size={24}>담당자</Text><Text x={844} y={286} size={24}>접수</Text></g>
      <Rule x={474} y={346} width={147} opacity={.4}/><Rule x={474} y={414} width={185} opacity={.4}/>
    </Reveal>
    <Arrow points={[{x: 985, y: 276}, {x: 1090, y: 276}]} value={notifying}/>
    <Reveal value={notifying} dx={16} dy={0}><path d="M1134 288V234C1134 184 1237 184 1237 234V288L1252 310H1119Z" fill={PASTEL.peach}/><path d="M1168 328C1171 350 1202 350 1206 328M1184 187V174"/><Text x={1186} y={400} align="middle" size={31} weight={700}>담당자 알림</Text><Check x={1260} y={203} value={phase(time, .61, .76)} size={29} color={SIGNAL}/></Reveal>
    <Reveal value={review}><path d="M563 498H925V561H563Z" fill={PASTEL.green}/><Check x={585} y={516} value={review} size={25}/><Text x={641} y={540} size={27} weight={660}>답변은 검토 후 전달</Text></Reveal>
    <MovingNote points={[{x: 326, y: 276}, {x: 448, y: 276}, {x: 555, y: 276}]} value={saving} accent={accent}/>
    <MovingNote points={[{x: 966, y: 276}, {x: 1119, y: 276}]} value={notifying} accent={accent}/>
  </>;
};

const dataRows = [{name: '드립백', value: '15,000', status: '완료'}, {name: '쿠키', value: '5,000', status: '취소'}, {name: '원두', value: '12,000', status: '완료'}, {name: '드립백', value: '15,000', status: '중복'}];
const Data = ({time, accent}: ArtProps) => {
  const cancel = phase(time, .2, .39), duplicate = phase(time, .36, .56), chart = phase(time, .48, .76), verified = phase(time, .69, .82);
  return <>
    <Reveal value={phase(time, .05, .2)}>
      <Paper x={40} y={66} width={538} height={462}><Text x={69} y={118} size={33} weight={730}>매출 원본</Text><Text x={547} y={118} size={21} align="end">실습용 숫자</Text><Rule x={40} y={144} width={538}/><Text x={66} y={190} size={25}>상품</Text><Text x={374} y={190} size={25} align="end">매출</Text><Text x={466} y={190} size={25} align="middle">상태</Text><Rule x={40} y={208} width={538}/>
        {dataRows.map((row, index) => {
          const rowY = 253 + index * 67, invalid = index === 1 ? cancel : index === 3 ? duplicate : 0;
          return <g key={`${row.name}-${index}`}>
            <g opacity={1 - invalid * .45}><Text x={66} y={rowY} size={27}>{row.name}</Text><Text x={374} y={rowY} size={27} align="end">{row.value}</Text><Text x={466} y={rowY} size={25} align="middle">{row.status}</Text></g>
            <path d={`M61 ${rowY - 10}H520`} stroke={PASTEL.red} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - invalid} opacity={invalid}/>
            <Rule x={40} y={rowY + 20} width={538} opacity={.35}/>
          </g>;
        })}
      </Paper>
    </Reveal>
    <Arrow points={[{x: 605, y: 291}, {x: 764, y: 291}]} value={chart}/>
    <Reveal value={chart} dx={18} dy={0}>
      <Paper x={795} y={66} width={548} height={462}><Text x={827} y={120} size={33} weight={740}>상품별 매출 보고서</Text><path d="M856 167V397H1276" fill="none"/>
        <rect x={924} y={397 - chart * 177} width={91} height={chart * 177} fill={PASTEL.blue}/><rect x={1110} y={397 - chart * 142} width={91} height={chart * 142} fill={PASTEL.green}/>
        <Text x={969} y={431} size={25} align="middle">드립백</Text><Text x={1155} y={431} size={25} align="middle">원두</Text><Text x={969} y={204} size={24} align="middle" opacity={chart}>15,000</Text><Text x={1155} y={241} size={24} align="middle" opacity={chart}>12,000</Text><Text x={827} y={492} size={26}>집계 합계</Text><Text x={1306} y={492} align="end" size={35} weight={750}>27,000원</Text>
      </Paper>
    </Reveal>
    <Reveal value={verified}><path d="M297 550H1068" stroke={SIGNAL}/><Check x={615} y={529} value={verified} size={29} color={SIGNAL}/><rect x={663} y={532} width={328} height={38} fill={PAPER} stroke="none"/><Text x={679} y={560} size={26} weight={640} color={SIGNAL}>원본·실제 정산금과 대조</Text></Reveal>
  </>;
};

const Tool = ({time, accent}: ArtProps) => {
  const calculation = phase(time, .23, .48), revision = phase(time, .55, .73), validated = phase(time, .69, .82);
  const changed = revision > .55;
  return <>
    <Reveal value={phase(time, .06, .23)}>
      <Text x={74} y={107} size={34} weight={710}>내 업무의 입력값</Text>
      <Text x={76} y={188} size={27}>수량</Text><rect x={230} y={148} width={205} height={62} fill={PAPER}/><Text x={409} y={190} size={31} align="end">10</Text>
      <Text x={76} y={283} size={27}>단가</Text><rect x={230} y={243} width={205} height={62} fill={PAPER}/><Text x={409} y={285} size={31} align="end">15,000</Text>
      <g opacity={revision}><Text x={76} y={378} size={27}>할인</Text><rect x={230} y={338} width={205} height={62} fill={PASTEL.peach}/><Text x={409} y={380} size={31} align="end">15,000</Text></g>
      <Text x={254} y={449} size={23} align="middle">실습 예시 · 단위: 원</Text>
    </Reveal>
    <Arrow points={[{x: 463, y: 273}, {x: 542, y: 273}]} value={calculation}/>
    <Reveal value={calculation}><path d="M573 197H827V358H573Z" fill={PASTEL.blue}/><Text x={700} y={241} align="middle" size={25} weight={650}>계산 규칙</Text><Multiline x={700} y={292} lines={changed ? ['수량 × 단가', '− 할인'] : ['수량 × 단가']} size={29} lineHeight={43} align="middle" weight={690}/></Reveal>
    <Arrow points={[{x: 850, y: 273}, {x: 930, y: 273}]} value={calculation}/>
    <Reveal value={phase(time, .31, .52)} dx={16} dy={0}>
      <Paper x={961} y={98} width={363} height={343} fill={PASTEL.green}><Text x={993} y={155} size={31} weight={710}>내 업무 계산기</Text><Rule x={989} y={183} width={300}/><Text x={993} y={246} size={25}>계산 결과</Text><Text x={1143} y={321} size={47} weight={780} align="middle" color={changed ? SIGNAL : INK}>{changed ? '135,000원' : '150,000원'}</Text><Rule x={990} y={359} width={300}/><Text x={1143} y={408} size={24} align="middle">규칙이 바뀌면 직접 수정</Text></Paper>
    </Reveal>
    <Reveal value={validated}><path d="M438 510H1323" fill="none"/><Check x={475} y={531} value={validated} size={27} color={SIGNAL}/><Text x={527} y={556} size={27} weight={660}>빈칸·오입력·파일 오류도 다시 테스트</Text></Reveal>
  </>;
};

const Team = ({time, accent}: ArtProps) => {
  const plan = phase(time, .13, .31), production = phase(time, .3, .48), review = phase(time, .48, .67), approval = phase(time, .68, .81);
  return <>
    <Reveal value={phase(time, .05, .2)}><path d="M113 77H937" strokeDasharray="7 9"/><Text x={526} y={58} size={26} align="middle">같은 사업 자료 · 같은 작업 기준</Text><path d="M151 77V132M502 77V132M849 77V132" strokeDasharray="7 9"/></Reveal>
    <Reveal value={plan}><Paper x={58} y={152} width={236} height={263}><Text x={89} y={209} size={30} weight={720}>기획안</Text><Rule x={90} y={246} width={166}/><Rule x={90} y={282} width={128}/><Rule x={90} y={318} width={156}/><Rule x={90} y={354} width={110}/></Paper><Text x={176} y={470} align="middle" size={33} weight={700}>기획</Text></Reveal>
    <Arrow points={[{x: 312, y: 285}, {x: 370, y: 285}]} value={production}/>
    <Reveal value={production}><rect x={393} y={152} width={235} height={263} fill={PAPER}/><Text x={422} y={203} size={29} weight={720}>제작물</Text><rect x={421} y={227} width={178} height={115} fill={PASTEL.blue} stroke="none"/><Cup x={469} y={247} scale={.8}/><Rule x={421} y={372} width={177}/><Text x={511} y={470} align="middle" size={33} weight={700}>제작</Text></Reveal>
    <Arrow points={[{x: 647, y: 285}, {x: 707, y: 285}]} value={review}/>
    <Reveal value={review}><path d="M735 168H972V415H735Z" fill={PAPER}/><rect x={790} y={149} width={126} height={37} fill={PASTEL.peach}/><Text x={763} y={235} size={29} weight={720}>검수 기록</Text>{['사실 확인', '브랜드 기준', '오류 점검'].map((label, index) => <g key={label}><Check x={761} y={265 + index * 47} size={23} value={phase(time, .5 + index * .04, .59 + index * .04)}/><Text x={808} y={287 + index * 47} size={23}>{label}</Text></g>)}<Text x={853} y={470} align="middle" size={33} weight={700}>검수</Text></Reveal>
    <Arrow points={[{x: 989, y: 285}, {x: 1065, y: 285}]} value={review}/>
    <Reveal value={phase(time, .55, .7)}>
      <path d="M1089 151V416M1106 151V416" strokeWidth={4}/>
      <path d={`M1106 ${285 - approval * 95}H1300`} stroke={approval > .7 ? SIGNAL : INK} strokeWidth={4}/>
      <circle cx={1220} cy={289} r={55} fill={approval > .7 ? PASTEL.green : PASTEL.peach}/>
      {approval > .7 ? <Check x={1197} y={269} size={43} value={approval} color={SIGNAL}/> : <path d="M1206 270V308M1230 270V308" strokeWidth={6}/>}
      <Text x={1204} y={470} align="middle" size={33} weight={740}>사장 승인</Text>
      <Text x={1204} y={521} align="middle" size={24} color={SIGNAL}>{approval > .7 ? '승인 후 다음 업무' : '승인 전 발송 중지'}</Text>
    </Reveal>
    <MovingNote points={[{x: 294, y: 285}, {x: 393, y: 285}]} value={production} accent={accent}/>
    <MovingNote points={[{x: 628, y: 285}, {x: 735, y: 285}]} value={review} accent={accent}/>
  </>;
};

const operationRows = ['계정·공유 권한', '사업 자료 입력 범위', '구독·API·호스팅 비용', '문제가 생기면 중지', '이전 상태 복구'];
const Operations = ({time, accent}: ArtProps) => {
  const stopped = phase(time, .41, .56), recovered = phase(time, .62, .8);
  return <>
    <Reveal value={phase(time, .05, .2)}>
      <Paper x={147} y={58} width={573} height={492}><Text x={181} y={116} size={37} weight={740}>내 사업 운영 카드</Text><Rule x={147} y={147} width={573}/>
        {operationRows.map((label, index) => <g key={label}><rect x={185} y={177 + index * 67} width={28} height={28} fill={PAPER}/><Check x={185} y={177 + index * 67} size={28} value={phase(time, .16 + index * .12, .27 + index * .12)} color={SIGNAL}/><Text x={238} y={201 + index * 67} size={28} weight={540}>{label}</Text>{index < operationRows.length - 1 ? <Rule x={180} y={225 + index * 67} width={501} opacity={.25}/> : null}</g>)}
      </Paper>
    </Reveal>
    <Reveal value={phase(time, .19, .36)}>
      <Text x={1036} y={104} size={30} weight={700} align="middle">멈추고, 돌아올 수 있게</Text>
      <circle cx={905} cy={221} r={47} fill={PASTEL.blue}/><path d="M891 201L924 221L891 241Z" fill={INK}/>
      <Arrow points={[{x: 966, y: 221}, {x: 1078, y: 221}]} value={phase(time, .24, .43)}/>
      <rect x={1105} y={172} width={111} height={99} fill={stopped > .5 ? PASTEL.peach : PAPER}/><path d="M1143 199V245M1177 199V245" strokeWidth={7}/>
      <Text x={905} y={313} size={25} align="middle">실행</Text><Text x={1160} y={313} size={25} align="middle">중지</Text>
      <Arrow points={[{x: 1160, y: 336}, {x: 1160, y: 414}, {x: 955, y: 414}]} value={recovered} color={SIGNAL}/>
      <circle cx={905} cy={414} r={47} fill={PASTEL.green}/><path d="M924 429C946 405 909 373 885 400M884 385V401H901" fill="none"/>
      <Text x={1033} y={511} size={26} align="middle" opacity={recovered}>이전 상태 복구 · 수동 처리</Text>
    </Reveal>
    <MovingNote points={[{x: 951, y: 221}, {x: 1080, y: 221}]} value={phase(time, .28, .48)} accent={accent}/>
  </>;
};

/** A pure frame-driven SVG. The parent owns titles, narration, and scene layout. */
export const StoryArt = ({kind, frame, durationInFrames, accent}: StoryArtProps) => {
  const time = clamp(frame / Math.max(1, durationInFrames - 1));
  const props = {time, accent};
  let art = null;
  switch (kind) {
    case 'foundation': art = <Foundation {...props}/>; break;
    case 'choice': art = <Choice {...props}/>; break;
    case 'content': art = <Content {...props}/>; break;
    case 'website': art = <Website {...props}/>; break;
    case 'inquiry': art = <Inquiry {...props}/>; break;
    case 'data': art = <Data {...props}/>; break;
    case 'tool': art = <Tool {...props}/>; break;
    case 'team': art = <Team {...props}/>; break;
    case 'operations': art = <Operations {...props}/>; break;
    default: break;
  }
  return <svg width={1400} height={600} viewBox="0 0 1400 600" role="img" aria-label={`${kind} 업무 흐름 도식`} style={{display: 'block', fontFamily: 'inherit', overflow: 'hidden'}}>
    <g stroke={INK} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none">{art}</g>
  </svg>;
};
