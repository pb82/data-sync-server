const _ = require('lodash')
const http = require('http')
const express = require('express')
const bodyParser = require('body-parser')
const {graphqlExpress, graphiqlExpress} = require('apollo-server-express')
const cors = require('cors')

const schemaParser = require('./lib/schemaParser')
const schemaListenerCreator = require('./lib/schemaListeners/schemaListenerCreator')

module.exports = async ({graphQLConfig, graphiqlConfig, postgresConfig, schemaListenerConfig}, models) => {
  const {tracing} = graphQLConfig
  let schema = await buildSchema(models)

  const app = express()

  app.use('*', cors())
  app.use('/graphql', bodyParser.json(), function (req, res, next) {
    const graphql = graphqlExpress({schema, tracing})
    return graphql(req, res, next)
  })

  // TODO Move this to the Admin UI
  app.get('/graphiql', graphiqlExpress(graphiqlConfig))

  const schemaListener = schemaListenerCreator(schemaListenerConfig)
  // "onReceive" will cause the server to reload the configuration which could be costly.
  // don't allow doing it too often!
  // we debounce the "onReceive" callback here to make sure it is debounced
  // for all listener implementations.
  // that means, the callback will be executed after the system waits until there
  // is no request to call it for N milliseconds.
  // like, when there's an evil client that notifies the listener every 100 ms,
  // we still wait for N ms after the notifications are over
  const onReceive = async () => {
    console.log('Received schema change notification. Rebuilding it')
    schema = await buildSchema(models)
  }
  const debouncedOnReceive = _.debounce(onReceive, 500)
  schemaListener.start(debouncedOnReceive)

  // Wrap the Express server
  const server = http.createServer(app)
  return server
}

async function buildSchema (models) {
  const graphQLSchema = await models.GraphQLSchema.findOne()
  let graphQLSchemaString = null
  if (graphQLSchema != null) {
    graphQLSchemaString = graphQLSchema.schema
  }

  const dataSources = await models.DataSource.findAll()
  let dataSourcesJson = dataSources.map((dataSource) => {
    return dataSource.toJSON()
  })

  const resolvers = await models.Resolver.findAll({
    include: [models.DataSource]
  })
  let resolversJson = resolvers.map((resolver) => {
    return resolver.toJSON()
  })

  if (_.isEmpty(graphQLSchemaString) || _.isEmpty(dataSourcesJson) || _.isEmpty(resolversJson)) {
    console.warn('At least one of schema, dataSources or resolvers is missing. Using noop defaults')
    // according to http://facebook.github.io/graphql/June2018/#sec-Root-Operation-Types,
    // a schema has to have 'query' field defined and it must be of object type!
    // let's add 'mutation' and 'subscription' as well, as they're generated by default using resolverMapper
    // and, an object must have a field: http://facebook.github.io/graphql/June2018/#sec-Objects
    graphQLSchemaString = `
      schema {
        query: Query
        mutation: Mutation
        subscription: Subscription
      }
      type Query {
        _: Boolean
      }
      type Mutation {
        _: Boolean
      }
      type Subscription {
        _: Boolean
      }
    `

    dataSourcesJson = {}
    resolversJson = {}
  }

  try {
    return schemaParser(graphQLSchemaString, dataSourcesJson, resolversJson)
  } catch (ex) {
    console.error('Error while building schema.')
    console.error(ex)
    throw new Error('Error while building schema.')
  }
}
