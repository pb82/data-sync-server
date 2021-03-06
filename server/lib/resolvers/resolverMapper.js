const _ = require('lodash')
const resolverBuilders = require('./builders')
const { compileMappings } = require('./compiler')

module.exports = function (dataSources, resolverMappings) {
  const resolvers = {
    Query: {},
    Mutation: {},
    Subscription: {}
  }

  _.forEach(resolverMappings, (resolverMapping) => {
    const resolverMappingName = resolverMapping.field

    if (_.isEmpty(resolverMapping.type)) {
      throw new Error('Missing query type for mapping: ' + resolverMappingName)
    }

    if (_.isEmpty(resolverMapping.DataSource)) {
      throw new Error('Missing data source for mapping: ' + resolverMappingName)
    }

    if (_.isEmpty(resolverMapping.requestMapping)) {
      throw new Error('Missing request mapping for mapping: ' + resolverMappingName)
    }

    if (_.isEmpty(resolverMapping.responseMapping)) {
      throw new Error('Missing response mapping for mapping: ' + resolverMappingName)
    }

    if (!(resolverMapping.DataSource.name in dataSources)) {
      throw new Error('Unknown data source "' + resolverMapping.DataSource.name + '" for mapping ' + resolverMappingName)
    }

    let { type, client } = dataSources[resolverMapping.DataSource.name]
    let builder = resolverBuilders[type]

    if (builder) {
      const { compiledRequestMapping, compiledResponseMapping } = compileMappings(resolverMapping.requestMapping, resolverMapping.responseMapping)
      if (builder.buildResolver && typeof builder.buildResolver === 'function') {
        const resolver = builder.buildResolver(
          client,
          compiledRequestMapping,
          compiledResponseMapping
        )

        resolvers[resolverMapping.type] = resolvers[resolverMapping.type] || {}
        resolvers[resolverMapping.type][resolverMappingName] = resolver
      } else {
        throw new Error(`resolver builder for ${type} missing buildResolver function`)
      }
    } else {
      throw new Error(`No resolver builder for type: ${type}`)
    }
  })

  return resolvers
}
