/**
 * Promotie-module — genereert gepersonaliseerde upsell-content voor kanalen
 * die een klant nog niet gebruikt, op basis van de website van de klant.
 */
const Anthropic = require('@anthropic-ai/sdk');
const fetch = require('node-fetch');

const PLATFORM_BLURB = {
  meta: 'Meta Ads (Facebook & Instagram) is sterk in doelgroep-targeting, visuele storytelling, retargeting en het opbouwen van naamsbekendheid bij een breed publiek.',
  google: 'Google Ads (zoekadvertenties) vangt actieve zoekintentie: mensen die al concreet op zoek zijn naar een product of dienst, wat vaak leidt tot een hoge conversieratio.',
  pinterest: 'Pinterest Ads bereikt mensen vroeg in hun oriëntatie- en planningsfase via visuele inspiratie, en werkt sterk voor lifestyle-, interieur-, mode- en productgerichte merken.',
};

const MODEL_PRIORITY = ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-sonnet-4-5'];

function isConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function getClient() {
  if (!isConfigured()) return null;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function normalizeWebsiteUrl(url) {
  if (!url) return '';
  const trimmed = String(url).trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return 'https://' + trimmed;
}

async function fetchWebsiteText(rawUrl) {
  const url = normalizeWebsiteUrl(rawUrl);
  if (!url) return '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WoelerRapportageBot/1.0; +https://woeler.nl)' },
    });
    if (!res.ok) throw new Error(`Website gaf status ${res.status} terug.`);
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.slice(0, 6000);
  } finally {
    clearTimeout(timeout);
  }
}

function buildPrompt({ clientName, website, websiteText, platform }) {
  const blurb = PLATFORM_BLURB[platform] || '';
  const system = `Je bent een ervaren online marketing consultant bij marketingbureau Woeler. Je schrijft korte, overtuigende, persoonlijke upsell-teksten voor bestaande klanten, om ze te enthousiasmeren voor een marketingkanaal dat ze nu nog niet gebruiken. De tekst moet concreet en specifiek aanvoelen voor déze klant (gebruik informatie van hun website waar mogelijk), niet generiek. Schrijf in het Nederlands, informele maar professionele tone-of-voice, zonder overdreven salesjargon.

Antwoord ALLEEN met een geldig JSON-object, zonder markdown-codeblok en zonder extra uitleg, in dit exacte formaat:
{"headline": "...", "subheadline": "...", "benefits": ["...", "...", "..."], "cta": "..."}

- headline: kort en pakkend (max 8 woorden), noemt het kanaal.
- subheadline: 1-2 zinnen, specifiek voor deze klant/branche, legt uit waarom dit kanaal kansen biedt.
- benefits: precies 3 items, elk 1 korte zin die een concreet voordeel van dit kanaal beschrijft, waar mogelijk gekoppeld aan wat je van de website hebt gezien.
- cta: 1 korte zin die aanzet tot een gesprek met hun marketeer/accountmanager om te starten met dit kanaal.`;

  const user = `Klant: ${clientName}
Website: ${website}
Te promoten kanaal: ${platform}
Korte uitleg van dit kanaal: ${blurb}

Inhoud van de website van de klant (ruwe tekst, gebruik dit om de tekst persoonlijk te maken):
"""
${websiteText || '(kon geen websitetekst ophalen, schrijf een iets algemenere maar nog steeds branche-relevante tekst)'}
"""

Schrijf nu de gepersonaliseerde promotietekst voor dit kanaal, in het gevraagde JSON-formaat.`;

  return { system, user };
}

async function generatePromoContent({ clientName, website, platform }) {
  const client = getClient();
  if (!client) throw new Error('ANTHROPIC_API_KEY is niet geconfigureerd op de server.');
  if (!website) throw new Error('Geen website bekend voor deze klant.');

  let websiteText = '';
  try {
    websiteText = await fetchWebsiteText(website);
  } catch (e) {
    websiteText = '';
  }

  const { system, user } = buildPrompt({ clientName, website, websiteText, platform });

  let lastError = null;
  for (const model of MODEL_PRIORITY) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 1000,
        temperature: 0.7,
        system,
        messages: [{ role: 'user', content: user }],
      });
      const block = response.content.find((b) => b.type === 'text');
      if (!block) throw new Error('Geen tekstantwoord ontvangen.');
      const match = block.text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Geen JSON gevonden in AI-antwoord.');
      const parsed = JSON.parse(match[0]);
      if (!parsed.headline || !Array.isArray(parsed.benefits)) {
        throw new Error('AI-antwoord mist verplichte velden.');
      }
      return {
        headline: String(parsed.headline).slice(0, 200),
        subheadline: String(parsed.subheadline || '').slice(0, 400),
        benefits: parsed.benefits.slice(0, 4).map((b) => String(b).slice(0, 300)),
        cta: String(parsed.cta || '').slice(0, 200),
      };
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error('Kon geen promotietekst genereren: ' + (lastError?.message || 'onbekende fout'));
}

module.exports = { generatePromoContent, isConfigured, fetchWebsiteText };
