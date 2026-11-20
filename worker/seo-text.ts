// Text of the server-rendered pages that search engines index, in every site language.
// Titles target what people actually type: "football quiz", "quiz foot", "Fußball Quiz",
// "players who played for both X and Y"…

export type SeoLang = 'en' | 'fr' | 'de' | 'es' | 'it' | 'pt';
export const SEO_LANGS: SeoLang[] = ['en', 'fr', 'de', 'es', 'it', 'pt'];
export const OG_LOCALE: Record<SeoLang, string> = { en: 'en_GB', fr: 'fr_FR', de: 'de_DE', es: 'es_ES', it: 'it_IT', pt: 'pt_PT' };

const VOWEL = /^[aeiouyhàâéèêëîïôöûüœ]/i;
/** "de Chelsea" / "d’Arsenal". */
const deFr = (c: string) => (VOWEL.test(c) ? `d’${c}` : `de ${c}`);
/** "del Milan" / "dell’Arsenal". */
const delIt = (c: string) => (VOWEL.test(c) ? `dell’${c}` : `del ${c}`);

export interface SeoText {
  homeTitle: string;
  homeDesc: (n: string) => string;
  homeH1: string;
  homeIntro: (n: string) => string;
  howTitle: string;
  howSteps: string[];
  clubsTitle: string;
  leaguesTitle: string;
  allClubs: string;
  hubTitle: string;
  hubDesc: string;
  hubH1: string;
  clubTitle: (c: string) => string;
  clubDesc: (c: string, n: string) => string;
  clubH1: (c: string) => string;
  clubIntro: (c: string, n: string) => string;
  pairTitle: (a: string, b: string) => string;
  pairDesc: (a: string, b: string, n: string) => string;
  pairH1: (a: string, b: string) => string;
  pairIntro: (a: string, b: string, n: string) => string;
  leagueTitle: (l: string) => string;
  leagueDesc: (l: string, n: string) => string;
  leagueH1: (l: string) => string;
  seasonTitle: (l: string, s: string) => string;
  seasonDesc: (l: string, s: string, n: string) => string;
  seasonH1: (l: string, s: string) => string;
  play: string;
  playHome: string;
  toFind: (n: string) => string;
  nationalities: (n: string) => string;
  internationals: (pct: number) => string;
  topNationalities: (list: string) => string;
  topFlightSeasons: (n: number) => string;
  champion: (club: string) => string;
  alsoPlayedFor: (c: string) => string;
  seasons: string;
  clubs: string;
  home: string;
  quizzes: string;
}

const en: SeoText = {
  homeTitle: 'Football quiz: how many footballers can you name?',
  homeDesc: (n) => `Free football quiz: name as many players as you can. ${n} players from the Premier League, La Liga, Serie A, Bundesliga and Ligue 1 since 2000. Daily challenge, club quizzes, play with friends.`,
  homeH1: 'Football quiz: how many players can you name?',
  homeIntro: (n) => `Type the names of as many footballers as you can before the clock runs out. ${n} players from the five big European leagues since 2000, a new daily challenge every day, a quiz for every club and private rooms to play with friends.`,
  howTitle: 'How to play',
  howSteps: [
    'Pick a theme: a club, two clubs, a league, a season, a nationality…',
    'Type player names. Small spelling mistakes are forgiven and a surname is enough when there is no doubt.',
    'Beat the clock, then compare your score on the leaderboard.',
  ],
  clubsTitle: 'Club quizzes',
  leaguesTitle: 'League quizzes',
  allClubs: 'All club quizzes',
  hubTitle: 'Football club quizzes: name every player',
  hubDesc: 'A quiz for every club of the Premier League, La Liga, Serie A, Bundesliga and Ligue 1 since 2000. How many players can you name?',
  hubH1: 'Club quizzes',
  clubTitle: (c) => `${c} quiz: name every ${c} player since 2000`,
  clubDesc: (c, n) => `How many ${c} players can you name? ${n} players have played for ${c} since 2000. Free football quiz, timed or unlimited.`,
  clubH1: (c) => `Can you name every ${c} player since 2000?`,
  clubIntro: (c, n) => `${n} footballers have played for ${c} since the 2000-01 season. Name as many as you can against the clock, or take your time in unlimited mode.`,
  pairTitle: (a, b) => `Players who played for both ${a} and ${b}: quiz`,
  pairDesc: (a, b, n) => `Can you name the ${n} footballers who played for both ${a} and ${b}? Free football quiz.`,
  pairH1: (a, b) => `Name the players who played for both ${a} and ${b}`,
  pairIntro: (a, b, n) => `${n} players have worn the shirts of both ${a} and ${b}. How many can you remember?`,
  leagueTitle: (l) => `${l} quiz: name every player since 2000`,
  leagueDesc: (l, n) => `How many ${l} players can you name? ${n} players since 2000. Free football quiz by season or club.`,
  leagueH1: (l) => `How many ${l} players can you name?`,
  seasonTitle: (l, s) => `${l} ${s} quiz: name the players`,
  seasonDesc: (l, s, n) => `Name as many players of the ${l} ${s} season as you can: ${n} to find. Free football quiz.`,
  seasonH1: (l, s) => `Name every ${l} player of the ${s} season`,
  play: 'Play this quiz',
  playHome: 'Play now',
  toFind: (n) => `${n} players to find`,
  nationalities: (n) => `${n} nationalities`,
  internationals: (pct) => `${pct}% are full internationals`,
  topNationalities: (l) => `Most represented nationalities: ${l}`,
  topFlightSeasons: (n) => `${n} top-flight seasons since 2000`,
  champion: (c) => `Champion: ${c}`,
  alsoPlayedFor: (c) => `Played for ${c} and…`,
  seasons: 'Seasons',
  clubs: 'Clubs',
  home: 'Home',
  quizzes: 'Quizzes',
};

const fr: SeoText = {
  homeTitle: 'Quiz foot : combien de footballeurs peux-tu citer ?',
  homeDesc: (n) => `Quiz foot gratuit : cite un maximum de joueurs. ${n} joueurs de Premier League, Liga, Serie A, Bundesliga et Ligue 1 depuis 2000. Défi du jour, quiz par club, parties entre amis.`,
  homeH1: 'Quiz foot : combien de joueurs peux-tu citer ?',
  homeIntro: (n) => `Écris le nom d'un maximum de footballeurs avant la fin du chrono. ${n} joueurs des cinq grands championnats européens depuis 2000, un nouveau défi chaque jour, un quiz pour chaque club et des salons privés pour jouer entre amis.`,
  howTitle: 'Comment jouer',
  howSteps: [
    'Choisis un thème : un club, deux clubs, un championnat, une saison, une nationalité…',
    'Écris des noms de joueurs. Les petites fautes sont pardonnées et le nom de famille suffit quand il n’y a pas de doute.',
    'Bats le chrono, puis compare ton score au classement.',
  ],
  clubsTitle: 'Quiz par club',
  leaguesTitle: 'Quiz par championnat',
  allClubs: 'Tous les quiz par club',
  hubTitle: 'Quiz foot par club : cite tous les joueurs',
  hubDesc: 'Un quiz pour chaque club de Premier League, Liga, Serie A, Bundesliga et Ligue 1 depuis 2000. Combien de joueurs peux-tu citer ?',
  hubH1: 'Quiz par club',
  clubTitle: (c) => `Quiz ${c} : cite tous les joueurs depuis 2000`,
  clubDesc: (c, n) => `Combien de joueurs ${deFr(c)} peux-tu citer ? ${n} joueurs sont passés par ${c} depuis 2000. Quiz foot gratuit, chrono ou illimité.`,
  clubH1: (c) => `Peux-tu citer tous les joueurs ${deFr(c)} depuis 2000 ?`,
  clubIntro: (c, n) => `${n} footballeurs ont joué pour ${c} depuis la saison 2000-01. Cites-en un maximum contre la montre, ou prends ton temps en mode illimité.`,
  pairTitle: (a, b) => `Joueurs passés par ${a} et ${b} : le quiz`,
  pairDesc: (a, b, n) => `Sauras-tu citer les ${n} footballeurs qui ont joué à la fois pour ${a} et ${b} ? Quiz foot gratuit.`,
  pairH1: (a, b) => `Cite les joueurs passés par ${a} et ${b}`,
  pairIntro: (a, b, n) => `${n} joueurs ont porté les maillots ${deFr(a)} et ${deFr(b)}. Combien t’en souviens-tu ?`,
  leagueTitle: (l) => `Quiz ${l} : cite tous les joueurs depuis 2000`,
  leagueDesc: (l, n) => `Combien de joueurs ${deFr(l)} peux-tu citer ? ${n} joueurs depuis 2000. Quiz foot gratuit par saison ou par club.`,
  leagueH1: (l) => `Combien de joueurs ${deFr(l)} peux-tu citer ?`,
  seasonTitle: (l, s) => `Quiz ${l} ${s} : cite les joueurs`,
  seasonDesc: (l, s, n) => `Cite un maximum de joueurs de la saison ${s} ${deFr(l)} : ${n} à trouver. Quiz foot gratuit.`,
  seasonH1: (l, s) => `Cite tous les joueurs ${deFr(l)} en ${s}`,
  play: 'Jouer à ce quiz',
  playHome: 'Jouer maintenant',
  toFind: (n) => `${n} joueurs à trouver`,
  nationalities: (n) => `${n} nationalités`,
  internationals: (pct) => `${pct} % sont internationaux A`,
  topNationalities: (l) => `Nationalités les plus représentées : ${l}`,
  topFlightSeasons: (n) => `${n} saisons dans l’élite depuis 2000`,
  champion: (c) => `Champion : ${c}`,
  alsoPlayedFor: (c) => `Passés par ${c} et…`,
  seasons: 'Saisons',
  clubs: 'Clubs',
  home: 'Accueil',
  quizzes: 'Quiz',
};

const de: SeoText = {
  homeTitle: 'Fußball-Quiz: Wie viele Fußballer kannst du nennen?',
  homeDesc: (n) => `Kostenloses Fußball-Quiz: Nenne so viele Spieler wie möglich. ${n} Spieler aus Bundesliga, Premier League, La Liga, Serie A und Ligue 1 seit 2000. Tägliche Challenge, Vereinsquiz, mit Freunden spielen.`,
  homeH1: 'Fußball-Quiz: Wie viele Spieler kannst du nennen?',
  homeIntro: (n) => `Tippe so viele Fußballer ein, wie du kannst, bevor die Zeit abläuft. ${n} Spieler aus den fünf großen europäischen Ligen seit 2000, jeden Tag eine neue Challenge, ein Quiz für jeden Verein und private Räume zum Spielen mit Freunden.`,
  howTitle: 'So wird gespielt',
  howSteps: [
    'Wähle ein Thema: ein Verein, zwei Vereine, eine Liga, eine Saison, eine Nationalität…',
    'Tippe Spielernamen ein. Kleine Tippfehler werden verziehen, der Nachname reicht, wenn er eindeutig ist.',
    'Schlag die Uhr und vergleiche deinen Score in der Rangliste.',
  ],
  clubsTitle: 'Vereinsquiz',
  leaguesTitle: 'Ligaquiz',
  allClubs: 'Alle Vereinsquiz',
  hubTitle: 'Fußball-Quiz nach Verein: Nenne alle Spieler',
  hubDesc: 'Ein Quiz für jeden Verein aus Bundesliga, Premier League, La Liga, Serie A und Ligue 1 seit 2000. Wie viele Spieler kannst du nennen?',
  hubH1: 'Vereinsquiz',
  clubTitle: (c) => `${c}-Quiz: Nenne alle Spieler seit 2000`,
  clubDesc: (c, n) => `Wie viele Spieler von ${c} kannst du nennen? ${n} Spieler haben seit 2000 für ${c} gespielt. Kostenloses Fußball-Quiz, auf Zeit oder ohne Limit.`,
  clubH1: (c) => `Kannst du alle Spieler von ${c} seit 2000 nennen?`,
  clubIntro: (c, n) => `${n} Fußballer haben seit der Saison 2000/01 für ${c} gespielt. Nenne so viele wie möglich gegen die Uhr oder lass dir im Modus ohne Limit Zeit.`,
  pairTitle: (a, b) => `Spieler, die für ${a} und ${b} gespielt haben: Quiz`,
  pairDesc: (a, b, n) => `Kennst du die ${n} Fußballer, die sowohl für ${a} als auch für ${b} gespielt haben? Kostenloses Fußball-Quiz.`,
  pairH1: (a, b) => `Nenne die Spieler, die für ${a} und ${b} gespielt haben`,
  pairIntro: (a, b, n) => `${n} Spieler haben das Trikot von ${a} und von ${b} getragen. An wie viele erinnerst du dich?`,
  leagueTitle: (l) => `${l}-Quiz: Nenne alle Spieler seit 2000`,
  leagueDesc: (l, n) => `Wie viele ${l}-Spieler kannst du nennen? ${n} Spieler seit 2000. Kostenloses Fußball-Quiz nach Saison oder Verein.`,
  leagueH1: (l) => `Wie viele ${l}-Spieler kannst du nennen?`,
  seasonTitle: (l, s) => `${l} ${s} Quiz: Nenne die Spieler`,
  seasonDesc: (l, s, n) => `Nenne so viele Spieler der ${l}-Saison ${s} wie möglich: ${n} zu finden. Kostenloses Fußball-Quiz.`,
  seasonH1: (l, s) => `Nenne alle ${l}-Spieler der Saison ${s}`,
  play: 'Quiz spielen',
  playHome: 'Jetzt spielen',
  toFind: (n) => `${n} Spieler zu finden`,
  nationalities: (n) => `${n} Nationalitäten`,
  internationals: (pct) => `${pct} % sind A-Nationalspieler`,
  topNationalities: (l) => `Häufigste Nationalitäten: ${l}`,
  topFlightSeasons: (n) => `${n} Erstliga-Saisons seit 2000`,
  champion: (c) => `Meister: ${c}`,
  alsoPlayedFor: (c) => `Spielten für ${c} und…`,
  seasons: 'Saisons',
  clubs: 'Vereine',
  home: 'Start',
  quizzes: 'Quiz',
};

const es: SeoText = {
  homeTitle: 'Quiz de fútbol: ¿cuántos futbolistas puedes nombrar?',
  homeDesc: (n) => `Quiz de fútbol gratis: nombra a todos los jugadores que puedas. ${n} jugadores de LaLiga, Premier League, Serie A, Bundesliga y Ligue 1 desde 2000. Reto diario, quiz por club, juega con amigos.`,
  homeH1: 'Quiz de fútbol: ¿cuántos jugadores puedes nombrar?',
  homeIntro: (n) => `Escribe el nombre de todos los futbolistas que puedas antes de que se acabe el tiempo. ${n} jugadores de las cinco grandes ligas europeas desde 2000, un reto nuevo cada día, un quiz para cada club y salas privadas para jugar con amigos.`,
  howTitle: 'Cómo se juega',
  howSteps: [
    'Elige un tema: un club, dos clubes, una liga, una temporada, una nacionalidad…',
    'Escribe nombres de jugadores. Se perdonan las pequeñas faltas y basta el apellido cuando no hay duda.',
    'Gánale al reloj y compara tu puntuación en la clasificación.',
  ],
  clubsTitle: 'Quiz por club',
  leaguesTitle: 'Quiz por liga',
  allClubs: 'Todos los quiz por club',
  hubTitle: 'Quiz de fútbol por club: nombra a todos los jugadores',
  hubDesc: 'Un quiz para cada club de LaLiga, Premier League, Serie A, Bundesliga y Ligue 1 desde 2000. ¿Cuántos jugadores puedes nombrar?',
  hubH1: 'Quiz por club',
  clubTitle: (c) => `Quiz del ${c}: nombra a todos los jugadores desde 2000`,
  clubDesc: (c, n) => `¿Cuántos jugadores del ${c} puedes nombrar? ${n} jugadores han pasado por el ${c} desde 2000. Quiz de fútbol gratis, contrarreloj o sin límite.`,
  clubH1: (c) => `¿Puedes nombrar a todos los jugadores del ${c} desde 2000?`,
  clubIntro: (c, n) => `${n} futbolistas han jugado en el ${c} desde la temporada 2000-01. Nombra a todos los que puedas contra el reloj, o tómate tu tiempo en el modo sin límite.`,
  pairTitle: (a, b) => `Jugadores que jugaron en ${a} y ${b}: quiz`,
  pairDesc: (a, b, n) => `¿Sabes nombrar a los ${n} futbolistas que jugaron en ${a} y en ${b}? Quiz de fútbol gratis.`,
  pairH1: (a, b) => `Nombra a los jugadores que jugaron en ${a} y ${b}`,
  pairIntro: (a, b, n) => `${n} jugadores han vestido las camisetas de ${a} y de ${b}. ¿De cuántos te acuerdas?`,
  leagueTitle: (l) => `Quiz de ${l}: nombra a todos los jugadores desde 2000`,
  leagueDesc: (l, n) => `¿Cuántos jugadores de ${l} puedes nombrar? ${n} jugadores desde 2000. Quiz de fútbol gratis por temporada o por club.`,
  leagueH1: (l) => `¿Cuántos jugadores de ${l} puedes nombrar?`,
  seasonTitle: (l, s) => `Quiz ${l} ${s}: nombra a los jugadores`,
  seasonDesc: (l, s, n) => `Nombra a todos los jugadores de la temporada ${s} de ${l} que puedas: ${n} por encontrar. Quiz de fútbol gratis.`,
  seasonH1: (l, s) => `Nombra a todos los jugadores de ${l} en ${s}`,
  play: 'Jugar a este quiz',
  playHome: 'Jugar ahora',
  toFind: (n) => `${n} jugadores por encontrar`,
  nationalities: (n) => `${n} nacionalidades`,
  internationals: (pct) => `El ${pct} % son internacionales absolutos`,
  topNationalities: (l) => `Nacionalidades más representadas: ${l}`,
  topFlightSeasons: (n) => `${n} temporadas en primera desde 2000`,
  champion: (c) => `Campeón: ${c}`,
  alsoPlayedFor: (c) => `Jugaron en ${c} y…`,
  seasons: 'Temporadas',
  clubs: 'Clubes',
  home: 'Inicio',
  quizzes: 'Quiz',
};

const it: SeoText = {
  homeTitle: 'Quiz calcio: quanti calciatori sai nominare?',
  homeDesc: (n) => `Quiz di calcio gratis: nomina più giocatori che puoi. ${n} giocatori di Serie A, Premier League, Liga, Bundesliga e Ligue 1 dal 2000. Sfida del giorno, quiz per squadra, gioca con gli amici.`,
  homeH1: 'Quiz calcio: quanti giocatori sai nominare?',
  homeIntro: (n) => `Scrivi il nome di più calciatori che puoi prima che scada il tempo. ${n} giocatori dei cinque grandi campionati europei dal 2000, una nuova sfida ogni giorno, un quiz per ogni squadra e stanze private per giocare con gli amici.`,
  howTitle: 'Come si gioca',
  howSteps: [
    'Scegli un tema: una squadra, due squadre, un campionato, una stagione, una nazionalità…',
    'Scrivi i nomi dei giocatori. I piccoli errori di battitura sono perdonati e basta il cognome quando non ci sono dubbi.',
    'Batti il cronometro e confronta il tuo punteggio in classifica.',
  ],
  clubsTitle: 'Quiz per squadra',
  leaguesTitle: 'Quiz per campionato',
  allClubs: 'Tutti i quiz per squadra',
  hubTitle: 'Quiz calcio per squadra: nomina tutti i giocatori',
  hubDesc: 'Un quiz per ogni squadra di Serie A, Premier League, Liga, Bundesliga e Ligue 1 dal 2000. Quanti giocatori sai nominare?',
  hubH1: 'Quiz per squadra',
  clubTitle: (c) => `Quiz ${c}: nomina tutti i giocatori dal 2000`,
  clubDesc: (c, n) => `Quanti giocatori ${delIt(c)} sai nominare? ${n} giocatori hanno vestito la maglia ${delIt(c)} dal 2000. Quiz di calcio gratis, a tempo o senza limiti.`,
  clubH1: (c) => `Sai nominare tutti i giocatori ${delIt(c)} dal 2000?`,
  clubIntro: (c, n) => `${n} calciatori hanno vestito la maglia ${delIt(c)} dalla stagione 2000-01. Nominane il più possibile contro il tempo, o prenditi il tuo tempo nella modalità senza limiti.`,
  pairTitle: (a, b) => `Giocatori che hanno giocato in ${a} e ${b}: quiz`,
  pairDesc: (a, b, n) => `Sai nominare i ${n} calciatori che hanno giocato sia con ${a} che con ${b}? Quiz di calcio gratis.`,
  pairH1: (a, b) => `Nomina i giocatori che hanno giocato in ${a} e ${b}`,
  pairIntro: (a, b, n) => `${n} giocatori hanno indossato le maglie di ${a} e ${b}. Quanti ne ricordi?`,
  leagueTitle: (l) => `Quiz ${l}: nomina tutti i giocatori dal 2000`,
  leagueDesc: (l, n) => `Quanti giocatori della ${l} sai nominare? ${n} giocatori dal 2000. Quiz di calcio gratis per stagione o per squadra.`,
  leagueH1: (l) => `Quanti giocatori della ${l} sai nominare?`,
  seasonTitle: (l, s) => `Quiz ${l} ${s}: nomina i giocatori`,
  seasonDesc: (l, s, n) => `Nomina più giocatori che puoi della stagione ${s} di ${l}: ${n} da trovare. Quiz di calcio gratis.`,
  seasonH1: (l, s) => `Nomina tutti i giocatori della ${l} ${s}`,
  play: 'Gioca a questo quiz',
  playHome: 'Gioca ora',
  toFind: (n) => `${n} giocatori da trovare`,
  nationalities: (n) => `${n} nazionalità`,
  internationals: (pct) => `Il ${pct}% ha giocato in nazionale maggiore`,
  topNationalities: (l) => `Nazionalità più rappresentate: ${l}`,
  topFlightSeasons: (n) => `${n} stagioni nella massima serie dal 2000`,
  champion: (c) => `Campione: ${c}`,
  alsoPlayedFor: (c) => `Hanno giocato con ${c} e…`,
  seasons: 'Stagioni',
  clubs: 'Squadre',
  home: 'Home',
  quizzes: 'Quiz',
};

const pt: SeoText = {
  homeTitle: 'Quiz de futebol: quantos jogadores consegues nomear?',
  homeDesc: (n) => `Quiz de futebol grátis: nomeia o máximo de jogadores. ${n} jogadores da Premier League, LaLiga, Serie A, Bundesliga e Ligue 1 desde 2000. Desafio diário, quiz por clube, joga com amigos.`,
  homeH1: 'Quiz de futebol: quantos jogadores consegues nomear?',
  homeIntro: (n) => `Escreve o nome do máximo de futebolistas antes que o tempo acabe. ${n} jogadores das cinco grandes ligas europeias desde 2000, um desafio novo todos os dias, um quiz para cada clube e salas privadas para jogar com amigos.`,
  howTitle: 'Como jogar',
  howSteps: [
    'Escolhe um tema: um clube, dois clubes, uma liga, uma época, uma nacionalidade…',
    'Escreve nomes de jogadores. Pequenos erros são perdoados e o apelido chega quando não há dúvida.',
    'Bate o relógio e compara a tua pontuação na classificação.',
  ],
  clubsTitle: 'Quiz por clube',
  leaguesTitle: 'Quiz por liga',
  allClubs: 'Todos os quiz por clube',
  hubTitle: 'Quiz de futebol por clube: nomeia todos os jogadores',
  hubDesc: 'Um quiz para cada clube da Premier League, LaLiga, Serie A, Bundesliga e Ligue 1 desde 2000. Quantos jogadores consegues nomear?',
  hubH1: 'Quiz por clube',
  clubTitle: (c) => `Quiz ${c}: nomeia todos os jogadores desde 2000`,
  clubDesc: (c, n) => `Quantos jogadores do ${c} consegues nomear? ${n} jogadores passaram pelo ${c} desde 2000. Quiz de futebol grátis, contra o relógio ou sem limite.`,
  clubH1: (c) => `Consegues nomear todos os jogadores do ${c} desde 2000?`,
  clubIntro: (c, n) => `${n} futebolistas jogaram no ${c} desde a época 2000-01. Nomeia o máximo contra o relógio, ou joga com calma no modo sem limite.`,
  pairTitle: (a, b) => `Jogadores que jogaram no ${a} e no ${b}: quiz`,
  pairDesc: (a, b, n) => `Consegues nomear os ${n} futebolistas que jogaram no ${a} e no ${b}? Quiz de futebol grátis.`,
  pairH1: (a, b) => `Nomeia os jogadores que jogaram no ${a} e no ${b}`,
  pairIntro: (a, b, n) => `${n} jogadores vestiram as camisolas do ${a} e do ${b}. De quantos te lembras?`,
  leagueTitle: (l) => `Quiz ${l}: nomeia todos os jogadores desde 2000`,
  leagueDesc: (l, n) => `Quantos jogadores da ${l} consegues nomear? ${n} jogadores desde 2000. Quiz de futebol grátis por época ou por clube.`,
  leagueH1: (l) => `Quantos jogadores da ${l} consegues nomear?`,
  seasonTitle: (l, s) => `Quiz ${l} ${s}: nomeia os jogadores`,
  seasonDesc: (l, s, n) => `Nomeia o máximo de jogadores da época ${s} da ${l}: ${n} por encontrar. Quiz de futebol grátis.`,
  seasonH1: (l, s) => `Nomeia todos os jogadores da ${l} ${s}`,
  play: 'Jogar este quiz',
  playHome: 'Jogar agora',
  toFind: (n) => `${n} jogadores por encontrar`,
  nationalities: (n) => `${n} nacionalidades`,
  internationals: (pct) => `${pct}% são internacionais A`,
  topNationalities: (l) => `Nacionalidades mais representadas: ${l}`,
  topFlightSeasons: (n) => `${n} épocas na primeira divisão desde 2000`,
  champion: (c) => `Campeão: ${c}`,
  alsoPlayedFor: (c) => `Jogaram no ${c} e…`,
  seasons: 'Épocas',
  clubs: 'Clubes',
  home: 'Início',
  quizzes: 'Quiz',
};

export const SEO_TEXT: Record<SeoLang, SeoText> = { en, fr, de, es, it, pt };
