import { choice, noul, score } from '@typesafe-ai/sdk';

// Reader intents. The same definitions are used to classify the article
// and each headline so the two distributions are directly comparable.
export const INTENTS = {
  search: {
    label: 'Search',
    definition:
      'Written for readers typing a specific query into a search engine: names the exact topic, entity or question up front and promises a direct answer (what, when, how much, how to, result, date, list).',
  },
  discover: {
    label: 'Discover',
    definition:
      'Written for readers browsing a feed who were not looking for it: leads with a human, surprising or emotionally engaging angle that earns a click through curiosity or relevance, without withholding the subject.',
  },
  news: {
    label: 'News',
    definition:
      'Written to report a new, time-sensitive development: who did what, what happened or changed, stated as a fresh fact in active voice.',
  },
  explainer: {
    label: 'Explainer',
    definition:
      'Written to help readers understand a topic or event: promises context, reasons, meaning or consequences (why, how it works, what it means).',
  },
};

const intentCriteria = Object.fromEntries(
  Object.entries(INTENTS).map(([key, v]) => [key, `${v.label}: ${v.definition}`]),
);

/** Stage 1: questions about the article itself. */
export function articleQuestions(sentences, entities) {
  const coreCriteria = Object.fromEntries(sentences.map((s) => [s.id, s.text]));
  coreCriteria.none = 'No single sentence states the core story on its own.';

  const subjectCriteria = Object.fromEntries(entities.map((e) => [e.id, e.text]));
  subjectCriteria.none = 'None of the listed names is the primary subject of the story.';

  return {
    core_story: choice(
      {
        task: 'Pick the one sentence from the article that best states its core story.',
        definition:
          'The core story is the single main development, finding or point the article delivers to the reader: who or what it is about and what happened or what the reader learns.',
        prefer: 'A sentence that states the main point itself over background, quotes, scene-setting, reactions or secondary details.',
        source: 'Sentences are copied verbatim from `article.body`.',
      },
      coreCriteria,
    ),
    primary_subject: choice(
      'Which listed name is the primary subject or entity of the story in `article.body` — the person, organisation, place, product or thing the story is mainly about?',
      subjectCriteria,
    ),
    article_intent: choice(
      'Which reader intent does the article in `article.body` actually serve best, judged by what it delivers rather than by its current headline?',
      intentCriteria,
    ),
  };
}

/** Stage 2: questions about one headline, judged against the article. */
export function headlineQuestions() {
  return {
    intent: choice(
      'Which reader intent is the headline in `headline` written for?',
      intentCriteria,
    ),
    names_subject: noul(
      {
        question: 'Does `headline` clearly and explicitly name the primary subject of the story?',
        subject: 'The primary subject is given in `article.primary_subject` when known; otherwise infer it from `article.core_story`.',
        note: 'A recognisable short form or well-known name counts. A pronoun, category or description instead of the name does not.',
      },
      {
        true: 'The reader can tell from the headline alone exactly who or what the story is about.',
        false: 'The subject is missing, generic or only hinted at.',
      },
    ),
    faithful: score(
      'How well does what `headline` promises match what the article actually delivers, as shown by `article.core_story` and `article.excerpt`?',
      [
        'Misleading: the headline promises something the article does not deliver, or misstates the story.',
        'Partial: it touches the story but overstates it, centres a minor detail, or misses the main point.',
        'Mostly accurate: it reflects the main story with small overreach or imprecision.',
        'Accurate: it promises exactly what the article delivers, no more and no less.',
      ],
    ),
    keyword_stuffing: noul(
      {
        question: 'Is `headline` keyword-stuffed?',
        signs: [
          'the same search term or near-synonyms repeated',
          'keyword phrases tacked on with pipes, dashes or colons',
          'strings of terms that do not read as a natural sentence',
        ],
      },
    ),
    vague_substitute: noul(
      {
        question: 'Does `headline` use a vague substitute where the article provides a specific name or fact?',
        examples: ['"this actor"', '"a popular app"', '"a big change"', '"you won\'t believe"', '"here\'s why"'],
      },
    ),
    redundant: noul(
      {
        question: 'Does `headline` contain redundant phrasing — words or ideas that repeat each other or add nothing?',
        examples: ['"completely destroyed"', '"new innovation"', '"past history"', 'stating the same fact twice'],
      },
    ),
    mixed_intents: noul(
      {
        question: 'Does `headline` try to serve more than one competing story intent at once?',
        examples: [
          'breaking news plus an explainer: "X resigns: here is everything you need to know about Y"',
          'two separate story angles joined by a colon, dash or "and"',
          'a news fact plus a curiosity tease about something else',
        ],
      },
    ),
    grammar_issue: noul(
      'Does `headline` contain a grammatical error, typo, missing word, dangling modifier or awkward construction that makes it read poorly?',
    ),
    wordy: noul(
      'Could `headline` say the same thing in noticeably fewer words without losing meaning or specificity?',
    ),
  };
}
