# Sonnenauf und Sonnenuntergang: Prognose Score

Der Hub schätzt für gespeicherte Drohnen Orte, wie schön ein Sonnenauf oder Sonnenuntergang wird.
Ergebnis: ein Score von 0 bis 100 mit den Einzelfaktoren. Code: `src/server/modules/drohne/sonnenuntergang.ts`.

**Wichtig:** Das ist eine einfache Heuristik aus allgemein bekannten Faustregeln der Fotografie, keine
validierte Vorhersage. Wie gut sie passt, zeigen erst deine Bewertungen (Vergleich Prognose gegen Realität
im Modul Drohne). Die Gewichte lassen sich anpassen.

## Daten

Open-Meteo Stundenwerte zur Stunde des Ereignisses (nächste volle Stunde, höchstens 60 Minuten Abstand):
Bewölkung getrennt nach tiefen, mittleren und hohen Schichten, Sicht, relative Luftfeuchte, Niederschlag.

Zusätzlich die tiefen Wolken an einem **Horizontpunkt**: 80 km vom Ort entfernt in Richtung des Sonnen
Azimuts (abends meist West bis Südwest, morgens Ost bis Südost). Grund: Tiefe Wolken dort verdecken die tief
stehende Sonne und verhindern, dass die Wolken über dem Ort von unten beleuchtet werden.

## Faktoren (jeweils 0 bis 1)

| Faktor | Formel | Idee |
|---|---|---|
| Wolken (Leinwand) | x = hohe + 0,6 × mittlere Bewölkung (max. 100). Bis 50: x / 50. Darüber: 1 minus (x minus 50) / 60. Das Ergebnis mal (1 minus tiefe Bewölkung am Ort / 100) | Hohe und mittlere Wolken färben sich rot. Zu wenig: nichts zu färben. Zu viel: geschlossene Decke. Tiefe Wolken verdecken die Leinwand |
| Freier Horizont | 1 minus tiefe Bewölkung am Horizontpunkt / 100 | Licht muss unter den Wolken durchkommen |
| Tiefe Wolken am Ort | 1 minus 0,8 × tiefe Bewölkung / 100 | Tiefe Wolken verdecken den Himmel |
| Sicht | (Sicht in km minus 5) / 25, begrenzt auf 0 bis 1 | Dunst und Nebel dämpfen die Farben |
| Luftfeuchte | bis 60 %: 1. Darüber linear bis 0,3 bei 95 % | Feuchte Luft wirkt milchig |
| Niederschlag | über 0,2 mm: 0,1. Bis 0,2 mm: 0,6. Kein Regen: 1 | Regen zur Stunde |

## Score

```
Score = 100 × Summe(Gewicht × Faktor) / Summe(Gewichte)
```

Standardgewichte: Wolken 0,35, Horizont 0,25, tiefe Wolken 0,15, Sicht 0,10, Regen 0,10, Feuchte 0,05.
Die Gewichte sind im Modul Drohne, Tab «Sonne», einstellbar und werden in den Einstellungen gespeichert
(`drohne.sonne.gewichte`).

## Rückmeldung und Vergleich

Nach einem Abend kannst du mit 1 bis 5 Sternen bewerten, wie schön er wirklich war. Gespeichert werden die
Prognose (Score und Faktoren, ermittelt am Mittag für den Abend und am Vorabend für den Morgen) und deine
Bewertung. Der Vergleich zeigt:

- mittlerer Fehler: Bewertung auf 0 bis 100 umgerechnet (1 Stern = 0, 5 Sterne = 100), Abstand zum Score
- Korrelation (ab 3 Bewertungen): nahe 1 heisst, die Prognose liegt oft richtig

Wenn der Vergleich zeigt, dass ein Faktor wenig aussagt, kannst du dessen Gewicht senken.

## Push

Regel «Schöner Sonnenauf oder untergang» in der Alarmzentrale. Schwelle Standard 75. Nur für Orte mit
eingeschaltetem «Push bei schönem Sonnenauf oder untergang». Sonnenuntergang wird um 13:00 geprüft,
Sonnenaufgang des nächsten Tages um 19:30. Die Meldung enthält Uhrzeit und Himmelsrichtung.

## Grenzen

- Open-Meteo Bewölkung ist ein Modellwert für eine Gitterzelle, keine Beobachtung
- Gelände (Berge im Westen) wird nicht berücksichtigt, Sonnenzeiten gelten für den mathematischen Horizont
- Saharastaub, Waldbrandrauch und Vulkanasche, die Sonnenuntergänge oft besonders farbig machen, fehlen
