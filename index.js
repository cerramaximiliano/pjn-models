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
    ConfiguracionScraping: require("./src/models/configuration_scraping"),
    ConfiguracionVerificacion: require("./src/models/configuration_scraping_verify"),
    ConfiguracionAppUpdate: require("./src/models/configuration_scraping_app_update"),
    ConfiguracionEmailVerification: require("./src/models/configuration_email_verification"),
    ConfiguracionExtraInfo: require("./src/models/configuration_extra_info"),
    Interviniente: require("./src/models/interviniente"),
    WorkerDailyStats: require("./src/models/worker-daily-stats"),
    ManagerConfig: require("./src/models/manager-config"),
};