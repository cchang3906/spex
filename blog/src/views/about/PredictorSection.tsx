import { Section } from "./Section";
import prose from "./Prose.module.css";
import styles from "./Architecture.module.css";
import { ink, hairline, blue, yellow, mint } from "./palette";

const lookup = [
  "The last few tool signatures of the live session form a string key.",
  "A pattern table mined from 2,116 agent trajectories, about 105,000 events, answers with what usually comes next and how often.",
  "One hash map lookup, roughly 100 nanoseconds, no model anywhere in the loop.",
  "During a session, online counts blend with the mined prior, so a repo's local habits sharpen the table while it runs.",
];

const grounding = [
  "The pattern table learns when: how likely verification is to follow an edit, from habits across thousands of sessions.",
  "The verifier lookup learns what: the concrete command and directory, from config detection or a command seen once and persisted across restarts.",
  "Arguments are never predicted from context, because verification commands are repo facts, not probabilities.",
];

const exam = [
  "Top-3 recall of 75.4 percent on held-out trajectories.",
  "Top-2 recall of 82 percent on real Codex sessions it never saw.",
  "100 percent on the trigger the product actually ships: verification after an edit.",
];


function WhenWhatDiagram() {
  return (
    <svg
      className={styles.diagramSvg}
      viewBox="0 0 680 220"
      role="img"
      aria-label="Two lookups must agree before anything launches: the pattern table answers when, the verifier lookup answers what, and only their combination becomes a launch."
    >
      <rect x="0" y="0" width="680" height="220" fill="#ffffff" />

      <rect x="28" y="24" width="240" height="76" fill={blue} opacity="0.3" stroke={ink} />
      <text x="44" y="48" fontSize="12.5" fontWeight="600" fill={ink}>when · pattern table</text>
      <text x="44" y="68" fontSize="10.5" fill={ink} opacity="0.7">EDIT(py) predicts TEST, p 0.35</text>
      <text x="44" y="84" fontSize="10.5" fill={ink} opacity="0.7">mined habits, blended live</text>

      <rect x="28" y="120" width="240" height="76" fill={yellow} opacity="0.3" stroke={ink} />
      <text x="44" y="144" fontSize="12.5" fontWeight="600" fill={ink}>what · verifier lookup</text>
      <text x="44" y="164" fontSize="10.5" fill={ink} opacity="0.7">pytest -q sympy/core/tests, cwd</text>
      <text x="44" y="180" fontSize="10.5" fill={ink} opacity="0.7">repo facts, config or observed</text>

      <line x1="268" y1="62" x2="356" y2="102" stroke={ink} strokeWidth="1.5" />
      <line x1="268" y1="158" x2="356" y2="118" stroke={ink} strokeWidth="1.5" />

      <rect x="356" y="86" width="140" height="48" fill="#ffffff" stroke={ink} />
      <text x="426" y="106" fontSize="11.5" fontWeight="600" fill={ink} textAnchor="middle">both must agree</text>
      <text x="426" y="123" fontSize="9.5" fill={ink} opacity="0.6" textAnchor="middle">no resolution, no launch</text>

      <line x1="496" y1="110" x2="560" y2="110" stroke={ink} strokeWidth="1.5" />
      <line x1="560" y1="110" x2="552" y2="105" stroke={ink} strokeWidth="1.5" />
      <line x1="560" y1="110" x2="552" y2="115" stroke={ink} strokeWidth="1.5" />

      <rect x="564" y="90" width="88" height="40" fill={mint} opacity="0.5" stroke={ink} />
      <text x="608" y="114" fontSize="11.5" fontWeight="600" fill={ink} textAnchor="middle">launch</text>
    </svg>
  );
}


function LookupDiagram() {
  return (
    <svg
      className={styles.diagramSvg}
      viewBox="0 0 680 250"
      role="img"
      aria-label="The lookup: the live session's last signatures join into a string key, one hash map access into the mined table, and out comes what usually follows with its probability."
    >
      <rect x="0" y="0" width="680" height="250" fill="#ffffff" />

      <text x="20" y="28" fontSize="10.5" fill={ink} opacity="0.6">live session, last k = 3 signatures</text>
      <rect x="20" y="40" width="104" height="30" fill={blue} opacity="0.3" stroke={ink} />
      <text x="72" y="59" fontSize="10.5" fill={ink} textAnchor="middle">READ(passed)</text>
      <rect x="132" y="40" width="104" height="30" fill={blue} opacity="0.3" stroke={ink} />
      <text x="184" y="59" fontSize="10.5" fill={ink} textAnchor="middle">TEST(passed)</text>
      <rect x="244" y="40" width="104" height="30" fill={blue} opacity="0.3" stroke={ink} />
      <text x="296" y="59" fontSize="10.5" fill={ink} textAnchor="middle">EDIT(py)</text>

      <line x1="184" y1="70" x2="184" y2="102" stroke={ink} strokeWidth="1.5" />
      <line x1="184" y1="102" x2="179" y2="94" stroke={ink} strokeWidth="1.5" />
      <line x1="184" y1="102" x2="189" y2="94" stroke={ink} strokeWidth="1.5" />
      <text x="196" y="92" fontSize="10" fill={ink} opacity="0.6">join("|")</text>

      <rect x="20" y="106" width="328" height="32" fill="#ffffff" stroke={ink} />
      <text x="184" y="126" fontSize="11" fill={ink} textAnchor="middle">"TEST(passed)|EDIT(py)"</text>

      <line x1="348" y1="122" x2="420" y2="122" stroke={ink} strokeWidth="1.5" />
      <line x1="420" y1="122" x2="412" y2="117" stroke={ink} strokeWidth="1.5" />
      <line x1="420" y1="122" x2="412" y2="127" stroke={ink} strokeWidth="1.5" />
      <text x="384" y="112" fontSize="10" fill={ink} opacity="0.6" textAnchor="middle">Map.get</text>
      <text x="384" y="140" fontSize="10" fill={ink} opacity="0.6" textAnchor="middle">~100 ns</text>

      <text x="424" y="28" fontSize="10.5" fill={ink} opacity="0.6">mined table, 2,146 trajectories</text>
      <rect x="424" y="40" width="236" height="128" fill="#ffffff" stroke={ink} />
      <line x1="424" y1="72" x2="660" y2="72" stroke={hairline} />
      <line x1="424" y1="104" x2="660" y2="104" stroke={hairline} />
      <line x1="424" y1="136" x2="660" y2="136" stroke={hairline} />
      <text x="436" y="60" fontSize="10" fill={ink} opacity="0.55">"EDIT(py)"  {'->'}  TEST 0.35</text>
      <rect x="426" y="106" width="232" height="28" fill={yellow} opacity="0.45" />
      <text x="436" y="92" fontSize="10" fill={ink} opacity="0.55">"TEST(passed)|TEST(passed)"  {'->'}  TEST 0.49</text>
      <text x="436" y="124" fontSize="10.5" fontWeight="600" fill={ink}>"TEST(passed)|EDIT(py)"  {'->'}  TEST 0.77</text>
      <text x="436" y="156" fontSize="10" fill={ink} opacity="0.55">"RUN(passed)|EDIT(py)"  {'->'}  TEST 0.41</text>

      <line x1="542" y1="168" x2="542" y2="200" stroke={ink} strokeWidth="1.5" />
      <line x1="542" y1="200" x2="537" y2="192" stroke={ink} strokeWidth="1.5" />
      <line x1="542" y1="200" x2="547" y2="192" stroke={ink} strokeWidth="1.5" />

      <rect x="424" y="204" width="236" height="32" fill={mint} opacity="0.45" stroke={ink} />
      <text x="542" y="224" fontSize="11" fill={ink} textAnchor="middle">candidate: test, p 0.77, to the gates</text>
    </svg>
  );
}

export function PredictorSection() {
  return (
    <Section id="predictor" heading="The predictor">
      <p className={prose.paragraph}>
        The predictor counts, it does not think.
      </p>
      <ul className={prose.bulletList}>
        {lookup.map((item) => (
          <li key={item} className={prose.bulletItem}>
            {item}
          </li>
        ))}
      </ul>
      <LookupDiagram />
      <p className={prose.paragraph}>
        A barista who knows the regulars needs no theory of caffeine: the habit
        says when to start the drink, the menu says what it is. Spex splits
        its guess the same way.
      </p>
      <ul className={prose.bulletList}>
        {grounding.map((item) => (
          <li key={item} className={prose.bulletItem}>
            {item}
          </li>
        ))}
      </ul>
      <WhenWhatDiagram />
      <p className={prose.paragraph}>
        Here is what the table actually contains, three real rows:
      </p>
      <div className={prose.schemaRow}>
        <div className={prose.schemaBlock}>
          {`{
  "context": ["TEST(passed)", "EDIT(py)"],
  "predicts": "TEST",
  "p": 0.77,
  "support": 2016
}`}
        </div>
        <table className={prose.miniTable}>
          <thead>
            <tr>
              <th>context</th>
              <th>p</th>
              <th>support</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>EDIT(py)</td>
              <td>0.35</td>
              <td>6095</td>
            </tr>
            <tr>
              <td>TEST(passed) | EDIT(py)</td>
              <td>0.77</td>
              <td>2016</td>
            </tr>
            <tr>
              <td>EDIT(py) | TEST(passed) | EDIT(py)</td>
              <td>0.77</td>
              <td>1119</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className={prose.schemaBlock}>
        {`"TEST(passed)|EDIT(py)"  ->  { TEST: 0.77 }`}
      </div>
      <p className={prose.paragraph}>
        Notice what longer context buys: one edit alone predicts a test run at
        p 0.35, but a passing test followed by an edit jumps to 0.77. The
        rolling window exists to catch exactly that.
      </p>
      <p className={prose.paragraph}>
        During the session, online counts blend with the mined prior, so a
        repository's local habits sharpen the table while it runs:{" "}
        <mark className={prose.mark}>
          the prior weight applies only to contexts the mined table actually
          contains, and unseen contexts trust the online estimate directly.
        </mark>
      </p>
      <div className={prose.mathBlock}>
        <span className={prose.mathExpr}>
          <em>p</em>
          <span>=</span>
          <span className={prose.frac}>
            <span className={prose.fracTop}>
              <em>
                p<sub>prior</sub>
              </em>
              {" · "}
              <em>W</em>
              {" + "}
              <em>
                n<sub>hits</sub>
              </em>
            </span>
            <span className={prose.fracBottom}>
              <em>W</em>
              {" + "}
              <em>
                n<sub>observations</sub>
              </em>
            </span>
          </span>
        </span>
        <span className={prose.mathNote}>
          <em>W</em> = 20
        </span>
      </div>
      <div className={prose.workedExample}>
        <p>
          The mined probability acts like 20 phantom observations. Concretely,
          take EDIT(py) with mined p 0.35:
        </p>
        <ul>
          <li>Session starts, no local data yet: p = 0.35, pure prior.</li>
          <li>
            This repo turns out to always test after edits. After 5 edits and
            5 tests: p = (0.35 x 20 + 5) / (20 + 5) = 0.48. Local habit is
            pulling the estimate up.
          </li>
          <li>
            After 20 edits and 20 tests: p = (7 + 20) / 40 = 0.68. By now the
            session's own evidence weighs as much as the entire mined corpus.
          </li>
        </ul>
      </div>
      <p className={prose.paragraph}>
        The table sharpens exactly as fast as the evidence accumulates:{" "}
        <mark className={prose.mark}>
          early in a session you trust 2,146 trajectories of strangers, an
          hour in you mostly trust this repo.
        </mark>
      </p>
      <p className={prose.paragraph}>
        The table sat an exam before any live run existed:
      </p>
      <ul className={prose.bulletList}>
        {exam.map((item) => (
          <li key={item} className={prose.bulletItem}>
            {item}
          </li>
        ))}
      </ul>
    </Section>
  );
}
