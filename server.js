const express = require("express");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");

const app = express();
const PORT = 8080;
const CHUNK_SIZE = 4; // how many sentences to group for context

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"))

const reference = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data", "reference.json"), 'utf8')
)

app.get('/', (req, res) => {
  res.render('index');
})

app.post('/analyze', (req, res) => {
  let { policy, source } = req.body;
  policy = policy.trim();
  source = source.trim();

  if (!policy || typeof policy != "string" || policy.length == 0) {
    return res.status(400).json({ error: "Policy invalid" });
  }

  if (!source || typeof source != "string" || source.length == 0) {
    return res.status(400).json({ error: "Source invalid" });
  }

  const chunks = analyze(makeChunks(policy), reference);
  const resultID = randomUUID();

  const results = {
    id: resultID,
    date: new Date().toISOString(),
    source,
    policy,
    chunks,
  }

  fs.writeFileSync(
    path.join(__dirname, 'data', 'results', `${resultID}.json`),
    JSON.stringify(results, null, 2) // add some indentation to make output more readable
  )

  res.render("results", { results, reference: reference, resultID });
})

app.get('/download/:id', (req, res) => {
  const filePath = path.join(__dirname, 'data', 'results', `${req.params.id}.json`);
  return res.download(filePath);
})

function makeChunks(policy) {
  policy = policy
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
  // replace escaped newlines and spaces with normal newlines and spaces to make them play nice, and trim the input

  //sentence regex from stackoverflow
  const sentenceRegex = /([^.!?]+(?:[.!?](?![.!?\s])[^.!?]*)*[.!?])/g;
  const sentences = policy.match(sentenceRegex) || [policy];

  const chunks = []
  let position = 0;
  let sentencesThisChunk = 0;
  let currentChunk = new Chunk();
  currentChunk.setStart(position);

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i].trim();
    currentChunk.addSentence(sentence);
    sentencesThisChunk++;
    position += sentence.length + 1;

    if (sentencesThisChunk >= CHUNK_SIZE) {
      currentChunk.setEnd(position - 1);
      chunks.push(currentChunk);
      currentChunk = new Chunk();
      currentChunk.setStart(position);
      sentencesThisChunk = 0;
    }
  }

  currentChunk.setEnd(position - 1);
  chunks.push(currentChunk);

  return chunks
}

function analyze(chunks, reference) {
  const patterns = reference.patterns;
  for (const chunk of chunks) {
    const text = chunk.getText().toLowerCase();

    for (const pattern of patterns) {
      // whether we found a match
      let matched = false;
      let confidence = 'none';

      // check for negations
      const negationRegex = /\b(not|no|never|don't|doesn't|won't|cannot)\b/i
      const hasNegation = negationRegex.test(chunk.text);

      for (const trigger of pattern.triggers) {
        const triggerHasNegation = negationRegex.test(trigger);
        // low confidence on negation mismatch
        confidence = (hasNegation != triggerHasNegation) ? 'low' : 'high';

        if (text.includes(trigger.toLowerCase())) {
          matched = true;
          break;
        }

        if (trigger.includes('.*') || trigger.includes('\\b')) {
          try {
            const regex = new RegExp(trigger, 'i');
            if (regex.test(text)) {
              matched = true;
              break;
            }
          } catch (error) {
            console.error(`Invalid regex: ${trigger}`)
          }
        }
      }

      if (matched) {
        chunk.addReference(pattern.id, pattern.category, confidence, pattern.description, pattern.severity, pattern.source_title, pattern.source_url);
      }
    }
  }

  return chunks;
}

class Chunk {
  constructor() {
    this.sentences = [];
    this.text = "";
    this.start = -1;
    this.end = -1;
    this.references = [];
  }

  addSentence(sentence) {
    this.sentences.push(sentence);
    if (this.text.length > 0) this.text += " "; // add spaces back after sentences
    this.text += sentence
  }

  getSentences() {
    return this.sentences;
  }

  setStart(start) {
    this.start = start;
  }

  getStart() {
    return this.start;
  }

  setEnd(end) {
    this.end = end;
  }

  getEnd() {
    return this.end;
  }

  getText() {
    return this.text;
  }

  addReference(id, category, confidence, description, severity, source_title, source_url) {
    this.references.push({
      id,
      category,
      confidence,
      description,
      severity,
      source_title,
      source_url
    })
  }
}

const resultsDir = path.join(__dirname, 'data', 'results');

if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir, { recursive: true })
}

app.listen(PORT, () => {
  console.log(`Listening on port: ${PORT}`)
})
