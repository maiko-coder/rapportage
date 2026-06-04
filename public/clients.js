/**
 * Klantconfiguratie
 *
 * Voeg hier je klanten toe. Elke klant heeft:
 *   - id:   unieke slug
 *   - name: weergavenaam
 *   - meta:      { connection_key, account_id }  (of null als niet van toepassing)
 *   - google:    { connection_key, account_id, data_view: "campaign" }
 *   - pinterest: { connection_key, account_id }
 *
 * connection_key en account_id haal je op via /api/connections (zie server.js).
 * Start de server en open http://localhost:3000/api/connections in Postman/Bruno
 * met body { "integration_id": "facebook_ads" } om de waarden te zien.
 */
const CLIENTS = [
  {
    id: 'voorbeeld',
    name: 'Voorbeeldklant',
    meta: {
      connection_key: 'jouw@email.nl',
      account_id: '1234567890',
    },
    google: {
      connection_key: 'jouw@email.nl',
      account_id: '1234567890',
      data_view: 'campaign',
    },
    pinterest: {
      connection_key: 'jouw@email.nl',
      account_id: '1234567890',
    },
  },
  // Voeg hier meer klanten toe...
];
