module.exports = {
    CausasCivil: require('./src/models/causas-civil'),
    CausasComercial: require('./src/models/causas-comercial'),
    CausasSegSoc: require("./src/models/causas-ss"),
    CausasTrabajo: require("./src/models/causas-trabajo"),
    CausasCAF: require('./src/models/causas-caf'),         // Contencioso Administrativo Federal
    CausasCCF: require('./src/models/causas-ccf'),         // Civil y Comercial Federal
    CausasCNE: require('./src/models/causas-cne'),         // Electoral
    CausasCPE: require('./src/models/causas-cpe'),         // Penal Económico
    CausasCFP: require('./src/models/causas-cfp'),         // Criminal y Correccional Federal
    CausasCCC: require('./src/models/causas-ccc'),         // Criminal y Correccional
    CausasCSJ: require('./src/models/causas-csj'),         // Corte Suprema de Justicia
    CausasFSM: require('./src/models/causas-fsm'),         // Justicia Federal de San Martin
    CausasCPF: require('./src/models/causas-cpf'),         // Camara Federal de Casación Penal
    CausasCPN: require('./src/models/causas-cpn'),         // Camara Nacional Casacion Penal
    CausasFBB: require('./src/models/causas-fbb'),         // Justicia Federal de Bahia Blanca
    CausasFCR: require('./src/models/causas-fcr'),         // Justicia Federal de Comodoro Rivadavia
    CausasFCB: require('./src/models/causas-fcb'),         // Justicia Federal de Córdoba
    CausasFCT: require('./src/models/causas-fct'),         // Justicia Federal de Corrientes
    CausasFGR: require('./src/models/causas-fgr'),         // Justicia Federal de General Roca
    CausasFLP: require('./src/models/causas-flp'),         // Justicia Federal de La Plata
    CausasFMP: require('./src/models/causas-fmp'),         // Justicia Federal de Mar del Plata
    CausasFMZ: require('./src/models/causas-fmz'),         // Justicia Federal de Mendoza
    CausasFPO: require('./src/models/causas-fpo'),         // Justicia Federal de Posadas
    CausasFPA: require('./src/models/causas-fpa'),         // Justicia Federal de Paraná
    CausasFRE: require('./src/models/causas-fre'),         // Justicia Federal de Resistencia
    CausasFSA: require('./src/models/causas-fsa'),         // Justicia Federal de Salta
    CausasFRO: require('./src/models/causas-fro'),         // Justicia Federal de Rosario
    CausasFTU: require('./src/models/causas-ftu'),         // Justicia Federal de Tucuman
    ConfiguracionScraping: require("./src/models/configuration_scraping"),
    ConfiguracionVerificacion: require("./src/models/configuration_scraping_verify"),
    ConfiguracionAppUpdate: require("./src/models/configuration_scraping_app_update"),
    ConfiguracionEmailVerification: require("./src/models/configuration_email_verification"),
    ConfiguracionExtraInfo: require("./src/models/configuration_extra_info"),
    Interviniente: require("./src/models/interviniente"),
    WorkerDailyStats: require("./src/models/worker-daily-stats"),
    WorkerHourlyStats: require("./src/models/worker-hourly-stats"),
    WorkerDailySummary: require("./src/models/worker-daily-summary"),
    ManagerConfig: require("./src/models/manager-config"),
};